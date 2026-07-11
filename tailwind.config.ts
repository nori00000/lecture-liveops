import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#0A0A0B',
        surface: '#141416',
        surfaceAlt: '#1B1B1F',
        border: '#26262B',
        text: '#E8E8EA',
        textDim: '#9A9AA1',
        textMute: '#8C8C94',
        accent: '#76B900',
        accentDim: '#4F7C00',
        warn: '#E0A800',
        danger: '#D04A3A',
        info: '#4A8FD0'
      },
      fontFamily: {
        sans: [
          'Pretendard Variable',
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'Roboto',
          'Helvetica Neue',
          'Segoe UI',
          'Apple SD Gothic Neo',
          'Noto Sans KR',
          'sans-serif'
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace']
      },
      fontSize: {
        xs: ['12px', { lineHeight: '1.5' }],
        sm: ['13px', { lineHeight: '1.5' }],
        base: ['14px', { lineHeight: '1.6' }],
        md: ['15px', { lineHeight: '1.6' }],
        lg: ['17px', { lineHeight: '1.5' }],
        xl: ['20px', { lineHeight: '1.4' }],
        '2xl': ['24px', { lineHeight: '1.35' }],
        '3xl': ['30px', { lineHeight: '1.3' }]
      },
      borderRadius: {
        DEFAULT: '6px',
        md: '8px',
        lg: '12px'
      }
    }
  },
  plugins: []
}

export default config
