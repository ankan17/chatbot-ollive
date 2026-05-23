import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ApiError } from '../api/errors.js';
import { useSession } from '../state/sessionContext.js';

export function useApiErrorRedirect(error?: ApiError): void {
  const navigate = useNavigate();
  const { refresh } = useSession();

  useEffect(() => {
    if (error?.code === 'unauthorized') {
      void refresh();
      navigate('/sign-in');
    }
  }, [error, navigate, refresh]);
}
