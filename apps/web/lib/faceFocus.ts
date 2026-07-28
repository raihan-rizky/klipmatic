'use client'

let detectorPromise:
  | Promise<import('@mediapipe/tasks-vision').FaceDetector>
  | null = null

async function detector() {
  if (!detectorPromise) {
    detectorPromise = import('@mediapipe/tasks-vision').then(
      async ({ FaceDetector, FilesetResolver }) => {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
        )
        return FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.5,
        })
      },
    )
  }
  return detectorPromise
}

export async function detectFaceFocusX(video: HTMLVideoElement): Promise<number | null> {
  const faceDetector = await detector()
  const result = faceDetector.detectForVideo(video, performance.now())
  const boxes = result.detections
    .map((detection) => detection.boundingBox)
    .filter((box): box is NonNullable<typeof box> => Boolean(box))
  if (boxes.length === 0 || video.videoWidth <= 0) return null
  const largest = boxes.sort((a, b) => b.width * b.height - a.width * a.height)[0]!
  return Math.min(
    Math.max((largest.originX + largest.width / 2) / video.videoWidth, 0),
    1,
  )
}
