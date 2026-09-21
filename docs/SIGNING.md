# Code Signing — Killing the SmartScreen Warning

When you run `FileMind.Setup.0.1.0.exe`, Windows shows **"Windows protected your PC"**
because the binary is **unsigned** and has **no SmartScreen reputation**. This is
expected for every new unsigned app — it does *not* mean the file is malware.

This document explains how to sign the release so the warning goes away.
The release workflow already supports signing: **you only need to add GitHub
secrets — no code changes.**

---

## How SmartScreen decides

| Situation | What users see |
|---|---|
| Unsigned binary | "Windows protected your PC" — blocked until *More info → Run anyway* |
| Signed with OV-class cert, low reputation | Same warning for the first days/weeks, then disappears as reputation builds with download volume |
| Signed with EV-class cert / Azure Trusted Signing | Warning typically disappears almost immediately (identity is strongly validated) |

**Reality check:** there is no free way to make the warning vanish for strangers
overnight. SmartScreen reputation is earned by signed binaries + download volume
over time. Anyone claiming otherwise is selling snake oil. Self-signed
certificates do **not** work for distribution (they only help on machines where
you manually installed the cert).

---

## Option A — Azure Trusted Signing (recommended, ≈ $9.99/month)

Microsoft's managed signing service. Identity-validated, and signed binaries get
SmartScreen reputation quickly. Cheapest option with near-instant results.

1. **Azure account** → create a **Trusted Signing** resource
   (Portal → Create a resource → "Trusted Signing"), pricing ~$9.99/month base tier.
2. Complete **identity validation** for yourself (individual validation is
   available; it can take a few business days).
3. In the Trusted Signing account, create a **Certificate Profile**
   (type: *Public Trust*). Note the **profile name**.
4. Note your **account name** and the **endpoint** URL (shown in the portal,
   e.g. `https://eus.codesigning.azure.net/` for East US — must match your region).
5. Create an **App registration** (Microsoft Entra ID) →
   *Certificates & secrets* → **New client secret**. Note the
   **Directory (tenant) ID**, **Application (client) ID** and the **secret value**.
6. Add **5 secrets** to this GitHub repo (*Settings → Secrets and variables → Actions → New repository secret*):

   | Secret name | Value |
   |---|---|
   | `AZURE_CODESIGN_ENDPOINT` | e.g. `https://eus.codesigning.azure.net/` |
   | `AZURE_CODESIGN_ACCOUNT` | your Trusted Signing account name |
   | `AZURE_CERT_PROFILE` | your certificate profile name |
   | `AZURE_TENANT_ID` | Directory (tenant) ID |
   | `AZURE_CLIENT_ID` | Application (client) ID |
   | `AZURE_CLIENT_SECRET` | the client secret value |

7. Push a tag (e.g. `git tag v0.1.1 && git push origin v0.1.1`).
   The workflow logs `Signing mode: azure-trusted-signing` and the uploaded
   `.exe` arrives signed.

Authentication inside the workflow uses Azure's `EnvironmentCredential`
(the three `AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET` env vars
are already wired into `release.yml`).

---

## Option B — Traditional certificate (PFX) — Certum for OSS ≈ €25/year

The cheapest real certificate for open-source developers is Certum's
**Open Source Code Signing** certificate (OV class). Expect SmartScreen
reputation to build over a few weeks of downloads rather than instantly.

1. Buy the certificate at certum.eu (open-source code signing for individuals).
2. Complete their identity verification, then export the key as a **`.pfx`**
   (their SimplySign cloud service provides export tooling).
3. Convert to base64 (works on any platform):

   ```bash
   base64 -w0 mycert.pfx > mycert.pfx.b64     # Linux / macOS / Git Bash
   certutil -encode mycert.pfx mycert.b64     # Windows (remove header/footer lines)
   ```

4. Add **2 secrets** to the repo:

   | Secret name | Value |
   |---|---|
   | `CSC_LINK` | the **entire base64 string** from step 3 |
   | `CSC_KEY_PASSWORD` | the PFX password |

5. Push a tag. The workflow logs `Signing mode: pfx-certificate`.

This path uses electron-builder's built-in `CSC_LINK` handling — timestamping
(RFC 3161) is applied automatically so signatures stay valid after the cert expires.

Other OV/EV vendors (Sectigo, SSL.com, DigiCert) work the same way via `CSC_LINK`.
EV certificates (hardware token, ~$300+/yr) give instant reputation but are
overkill at this stage.

---

## Option C — SignPath.io (free for open source)

SignPath grants **free code-signing certificates** to accepted open-source
projects (issued under the SignPath Foundation). Zero cost, but reputation
builds like any OV cert, and approval takes some time.

1. Apply at <https://signpath.io/policies> (open-source program) with the repo URL.
2. Once approved: install the **SignPath GitHub App**, connect the project,
   create an API token.
3. Add secrets `SIGNPATH_API_TOKEN` and `SIGNPATH_ORGANIZATION_ID`, then add this
   step to `release.yml` after the packaging step (SignPath signs the produced
   artifact and re-uploads it):

   ```yaml
   - name: Sign with SignPath
     if: ${{ env.SIGNPATH_API_TOKEN != '' }}
     uses: signpath/github-action-signpath@v1
     with:
       api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
       organization-id: ${{ secrets.SIGNPATH_ORGANIZATION_ID }}
       project-slug: filemind
       signing-policy-slug: release-signing
       artifact-configuration-slug: electron-app
       input-artifact-glob: release/*.exe
       service-url: https://app.signpath.io/api/v1
   ```

---

## What I will see after signing?

- **Azure (Option A):** installer shows *Publisher: your validated identity*
  instead of *Unknown publisher*; SmartScreen warning disappears for the vast
  majority of users almost immediately.
- **OV cert (Options B/C):** warning disappears progressively as reputation
  accumulates. Until then, users still click *More info → Run anyway*, but the
  dialog shows a verified publisher — a meaningful trust signal.

## Verifying a signature

After a signed release, check on any Windows machine:

```powershell
Get-AuthenticodeSignature .\FileMind.Setup.0.1.1.exe | Format-List
# Status should be "Valid", plus a timestamp entry
```

## Current state

- `release.yml` supports **all options above**, auto-detected by which secrets
  exist. With **no secrets** it builds unsigned exactly as before — nothing breaks.
- The v0.1.0 installer published today is **unsigned** (that is why SmartScreen
  fires). The signing activates from the **next tag** (e.g. `v0.1.1`) once you
  add secrets.
