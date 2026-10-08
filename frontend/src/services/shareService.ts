import type { FeedbackSection } from '../types'

export interface SharedReview {
  overall_score: number | null
  sections: FeedbackSection[] | null
}

export async function createShareLink(reviewId: string): Promise<string> {
  const token = localStorage.getItem('token')
  if (!token) throw new Error('Please sign in to share this review')
  const response = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/share`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!response.ok) throw new Error('Unable to create a review link. Please try again.')
  const data: { token: string } = await response.json()
  return new URL(`/shared/reviews/${encodeURIComponent(data.token)}`, window.location.origin).href
}

export async function getSharedReview(token: string, signal?: AbortSignal): Promise<SharedReview> {
  const response = await fetch(`/api/reviews/shared/${encodeURIComponent(token)}`, {
    credentials: 'omit',
    signal
  })
  if (!response.ok) {
    throw new Error(response.status === 404
      ? 'This review link is invalid, expired, or unavailable.'
      : 'Unable to load this review. Please try again later.')
  }
  return response.json()
}
