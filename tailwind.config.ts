import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        porcelain: '#FFFCF7',
        espresso: '#432222',
        plum: '#7A3B69',
        berry: '#B4436C',
        blush: '#E8B4CB',
      },
      fontFamily: {
        serif: ['"New York"', 'ui-serif', 'Georgia', 'serif'],
        body: ['"Abbode Berlin"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
