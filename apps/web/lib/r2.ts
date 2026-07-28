import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

function client(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  })
}

function command(key: string): GetObjectCommand {
  return new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key })
}

export async function signedR2Get(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(client(), command(key), { expiresIn })
}

export async function readR2Json<T>(key: string): Promise<T> {
  const response = await client().send(command(key))
  if (!response.Body) throw new Error(`Objek R2 ${key} tidak mempunyai body`)
  return JSON.parse(await response.Body.transformToString()) as T
}

export async function readR2JsonIfExists<T>(key: string): Promise<T | null> {
  const s3 = client()
  try {
    await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: key }))
  } catch (error) {
    if (
      error instanceof S3ServiceException &&
      (error.name === 'NotFound' || error.$metadata.httpStatusCode === 404)
    ) {
      return null
    }
    throw error
  }
  const response = await s3.send(command(key))
  if (!response.Body) return null
  return JSON.parse(await response.Body.transformToString()) as T
}
