import { useState, type FormEvent } from 'react'

/**
 * Set VITE_CONTACT_ENDPOINT (e.g. a Formspree / Basin / Netlify Forms URL) to receive submissions.
 * The form is POSTed as JSON with fields: Name, Email, Message.
 */
const endpoint = import.meta.env.VITE_CONTACT_ENDPOINT as string | undefined

type Status = 'idle' | 'sending' | 'done' | 'error'

export default function ContactForm() {
  const [status, setStatus] = useState<Status>('idle')

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!endpoint) {
      setStatus('error')
      return
    }
    setStatus('sending')
    try {
      const data = Object.fromEntries(new FormData(e.currentTarget))
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(data),
      })
      setStatus(res.ok ? 'done' : 'error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <section>
      <div className="section cc-contact">
        <div className="container">
          <div className="contact">
            <div className="contact-headline">
              <h3>
                Want to get in touch?
                <br />
                Drop me a line.
              </h3>
            </div>
            <div className="contact-form-wrap">
              <div className="w-form">
                {status !== 'done' && (
                  <form className="contact-form" onSubmit={onSubmit}>
                    <div className="w-layout-grid contact-form-grid">
                      <div>
                        <label htmlFor="Name">Name</label>
                        <input className="text-field w-input" maxLength={256} name="Name" placeholder="Enter your name" type="text" id="Name" />
                      </div>
                      <div>
                        <label htmlFor="Email">Email Address</label>
                        <input className="text-field w-input" maxLength={256} name="Email" placeholder="Enter your email" type="email" id="Email" required />
                      </div>
                      <div>
                        <label htmlFor="Message">MESSAGE</label>
                        <textarea id="Message" name="Message" maxLength={5000} placeholder="Enter your message" className="text-field cc-textarea w-input" />
                      </div>
                    </div>
                    <input
                      type="submit"
                      className="button w-button"
                      value={status === 'sending' ? 'Please wait...' : 'Submit'}
                      disabled={status === 'sending'}
                    />
                  </form>
                )}
                {status === 'done' && (
                  <div className="status-message cc-success-message w-form-done" style={{ display: 'block' }}>
                    <div>Thank you! Your submission has been received!</div>
                  </div>
                )}
                {status === 'error' && (
                  <div className="status-message cc-error-message w-form-fail" style={{ display: 'block' }}>
                    <div>
                      {endpoint
                        ? 'Oops! Something went wrong while submitting the form.'
                        : 'The contact form is not connected yet (set VITE_CONTACT_ENDPOINT).'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
