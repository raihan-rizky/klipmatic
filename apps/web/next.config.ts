import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@klipmatic/shared', '@klipmatic/db'],
}

export default config
