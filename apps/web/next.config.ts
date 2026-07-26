import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@cheapclipper/shared', '@cheapclipper/db'],
}

export default config
