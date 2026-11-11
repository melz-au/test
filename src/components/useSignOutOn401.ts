import { useEffect } from 'react'
import { ApiError, setPassword } from '../lib/admin-api'

/** When the admin API says the password is wrong (e.g. it was changed), sign out and show the login form. */
export default function useSignOutOn401(error: unknown) {
  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      setPassword(null)
      window.location.reload()
    }
  }, [error])
}
