import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ReviewSection } from '../components/ReviewSection'
import { getSharedReview, SharedReview } from '../services/shareService'

export const SharedReviewPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>()
  const [review, setReview] = useState<SharedReview | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setReview(null)
    setError('')
    getSharedReview(token, controller.signal)
      .then(data => { if (!controller.signal.aborted) setReview(data) })
      .catch(err => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Unable to load this review.')
        }
      })
    return () => controller.abort()
  }, [token])

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-gray-900">Shared Portfolio Review</h1>
        <p className="mt-2 mb-8 text-gray-600">Read-only summary. Links expire 30 days after creation.</p>
        {error && <p role="alert" className="p-4 bg-red-50 text-red-800 rounded-lg">{error}</p>}
        {!error && !review && <p role="status">Loading review...</p>}
        {review && (
          <>
            {review.overall_score !== null && (
              <section className="mb-8 bg-white rounded-lg shadow p-8">
                <h2 className="text-lg font-semibold text-gray-900">Overall Score</h2>
                <p className="mt-2 text-2xl font-bold text-blue-600">{Math.round(review.overall_score * 100)}/100</p>
              </section>
            )}
            <section className="space-y-6">
              <h2 className="text-2xl font-bold text-gray-900">Feedback</h2>
              {review.sections?.length
                ? review.sections.map((section, index) => <ReviewSection key={index} section={section} />)
                : <p className="text-gray-600">No feedback sections available</p>}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
