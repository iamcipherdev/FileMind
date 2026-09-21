/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 50: '#f6f7f9', 100: '#eceef2', 200: '#d5dae2', 300: '#b1bac9', 400: '#8794ab', 500: '#687893', 600: '#536179', 700: '#444f62', 800: '#3b4353', 900: '#343a46', 950: '#16181f' },
        mint: { 50: '#effaf4', 100: '#d7f3e4', 200: '#b0e6cd', 300: '#7cd2ae', 400: '#47b78b', 500: '#269c72', 600: '#187e5c', 700: '#14654c', 800: '#12503e', 900: '#104234', 950: '#05251c' },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
