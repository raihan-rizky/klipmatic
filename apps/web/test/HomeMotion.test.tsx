// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import Home from '@/app/page'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

test('landing exposes cinematic intake choreography hooks', () => {
  render(<Home />)

  expect(screen.getByRole('heading', { level: 1 })).toHaveClass('motion-reveal')
  expect(screen.getByLabelText('Clip intake desk')).toHaveClass('motion-intake')
  expect(screen.getByLabelText('Clip intake desk').querySelector('[aria-hidden="true"]')).toHaveClass(
    'motion-scan',
  )
  expect(screen.getByRole('region').querySelector('[aria-hidden="true"]')).toHaveClass('motion-signal')
  expect(screen.getAllByRole('listitem')[0]).toHaveClass('motion-workflow-cell')
})
