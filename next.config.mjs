/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel builds Next.js natively — no standalone/Docker output needed.
  // serverComponentsExternalPackages keeps sharp external (correct on Vercel too).
  experimental: { serverComponentsExternalPackages: ['sharp'] },
};
export default nextConfig;
