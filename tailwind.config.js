/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f8f7f4',
          100: '#efece5',
          200: '#dcd6c8',
          300: '#bdb39c',
          400: '#8d836b',
          500: '#5e5644',
          600: '#3f3a2d',
          700: '#2a2620',
          800: '#1a1814',
          900: '#0f0d0a',
        },
        accent: {
          50: '#fef6ee',
          100: '#fde9d3',
          200: '#fad0a6',
          300: '#f6b06e',
          400: '#f08a3b',
          500: '#d96f1e',
          600: '#b25515',
          700: '#8b4214',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
        serif: ['"Source Serif 4"', 'ui-serif', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}
