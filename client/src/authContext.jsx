import { createContext, useContext } from 'react';

// Shared across the app so any page can check "am I an admin?" without re-fetching /me.
// The server enforces this too (requireAdmin on every mutating route) - this context is only
// for hiding/disabling edit controls in the UI, not the actual security boundary.
export const AuthContext = createContext({ username: '', role: 'user' });

export function useAuth() {
  return useContext(AuthContext);
}

export function useIsAdmin() {
  return useContext(AuthContext).role === 'admin';
}
