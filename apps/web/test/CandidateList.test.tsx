// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { CandidateList } from '@/components/CandidateList'

test('renders ranked candidate details and transcript disclosure', () => {
  render(
    <CandidateList
      candidates={[
        {
          id: 'candidate-1',
          rank: 1,
          title: 'Hook yang kuat',
          hookText: 'Kalimat pembuka',
          startSec: 10,
          endSec: 42,
          score: 0.91,
          reason: 'Langsung ke inti',
          transcriptSlice: 'Isi transkrip',
          thumbnailStatus: 'ready',
          thumbnailUrl: '/api/candidates/candidate-1/thumbnail',
        },
      ]}
    />,
  )

  expect(screen.getByText('#1')).toBeVisible()
  expect(screen.getByText('91')).toBeVisible()
  expect(screen.getByRole('button', { name: /Lihat kutipan/i })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Edit klip' })).toBeVisible()
})
