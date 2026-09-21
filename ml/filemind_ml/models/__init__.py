"""Model definitions. All three are trained from scratch — no pretrained weights.

Import submodules directly (torch-dependent models are imported lazily so the
sklearn-only baseline works without PyTorch installed):

    from filemind_ml.models.baseline import BaselineClassifier
    from filemind_ml.models.textcnn import TextCNN          # needs torch
    from filemind_ml.models.transformer import FileTransformer  # needs torch
"""
