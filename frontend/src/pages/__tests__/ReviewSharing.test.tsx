import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../App'
import { AuthProvider } from '../../context/AuthContext'
import { ReviewPage } from '../ReviewPage'
import { SharedReviewPage } from '../SharedReviewPage'

const review = {
  id: 'review-1', profile_id: 'private-profile', status: 'complete', overall_score: 0.81,
  sections: [{ section_name: 'Skills', content: 'Useful feedback', confidence: 0.9, suggestions: ['Add examples'] }],
  created_at: '2026-10-07', updated_at: '2026-10-07'
}

function json(data: unknown, status = 200) {
  return { ok: status === 200, status, json: async () => data } as Response
}

function openApp(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>)
}

describe('public review sharing', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('opens the real public route while logged out and exposes no owner actions', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ overall_score: 0.81, sections: review.sections }))
    openApp('/shared/reviews/public-token')
    expect(await screen.findByText('81/100')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Skills/ }))
    expect(screen.getByText('Useful feedback')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Copy link|Export|Back to Dashboard/ })).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/reviews/shared/public-token', expect.objectContaining({ credentials: 'omit' }))
    const options = vi.mocked(fetch).mock.calls[0][1]
    expect(options?.headers).toBeUndefined()
  })

  it('keeps the original review route protected while logged out', async () => {
    openApp('/reviews/review-1')
    expect(await screen.findByRole('button', { name: 'Login' })).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([404, 500])('shows an error for an unavailable public review (%s)', async status => {
    vi.mocked(fetch).mockResolvedValue(json({}, status))
    openApp('/shared/reviews/bad-token')
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 404 ? /invalid, expired/ : /Unable to load/)
    expect(screen.queryByText('81/100')).not.toBeInTheDocument()
  })

  it('renders loading, missing score and empty feedback without inventing a score', async () => {
    let resolve!: (response: Response) => void
    vi.mocked(fetch).mockReturnValue(new Promise(done => { resolve = done }))
    openApp('/shared/reviews/public-token')
    expect(await screen.findByRole('status')).toHaveTextContent('Loading review')
    resolve(json({ overall_score: null, sections: null }))
    expect(await screen.findByText('No feedback sections available')).toBeInTheDocument()
    expect(screen.queryByText(/\/100/)).not.toBeInTheDocument()
  })

  it('ignores an old request after the shared token changes', async () => {
    let resolveOld!: (response: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise(done => { resolveOld = done }))
      .mockResolvedValueOnce(json({ overall_score: 0.5, sections: [] }))
    const first = render(<MemoryRouter initialEntries={['/shared/reviews/old']}><Routes>
      <Route path="/shared/reviews/:token" element={<SharedReviewPage />} />
    </Routes></MemoryRouter>)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal
    first.unmount()
    expect(signal?.aborted).toBe(true)
    openApp('/shared/reviews/new')
    expect(await screen.findByText('50/100')).toBeInTheDocument()
    resolveOld(json({ overall_score: 0.81, sections: [] }))
    expect(screen.queryByText('81/100')).not.toBeInTheDocument()
  })

  it.each(['success', 'creation-error', 'clipboard-error'])('handles Copy link: %s', async outcome => {
    const user = userEvent.setup()
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText')
    if (outcome === 'clipboard-error') clipboard.mockRejectedValue(new Error('Permission denied'))
    localStorage.setItem('token', 'owner-token')
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).endsWith('/share')) {
        return outcome === 'creation-error' ? json({}, 500) : json({ token: 'public-token' })
      }
      return json(review)
    })
    render(<MemoryRouter initialEntries={['/reviews/review-1']}><Routes>
      <Route path="/reviews/:reviewId" element={<ReviewPage />} />
    </Routes></MemoryRouter>)
    const button = await screen.findByRole('button', { name: 'Copy link' })
    await user.click(button)
    if (outcome === 'success') {
      expect(await screen.findByRole('status')).toHaveTextContent('Review link copied!')
      expect(clipboard).toHaveBeenCalledWith(`${window.location.origin}/shared/reviews/public-token`)
    } else {
      expect(await screen.findByRole('alert')).toHaveTextContent('Unable to create or copy')
      expect(screen.queryByText(/Review link copied!/)).not.toBeInTheDocument()
      if (outcome === 'creation-error') expect(clipboard).not.toHaveBeenCalled()
    }
    expect(fetch).toHaveBeenCalledWith('/api/reviews/review-1/share', {
      method: 'POST', headers: { Authorization: 'Bearer owner-token' }
    })
    expect(button).toBeEnabled()
    clipboard.mockRestore()
  })
})
