/** @type {import('next').NextConfig} */
const nextConfig = {
  // Rein statischer Export: kein Server, kein Backend. Alles läuft im Browser.
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
};

export default nextConfig;
