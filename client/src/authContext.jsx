import { createContext, useContext } from 'react';

// Shared across the app so any page can check "am I an admin?" without re-fetching /me.
// The server enforces this too (requireAdmin on every mutating route) - this context is only
// for hiding/disabling edit controls in the UI, not the actual security boundary.
export const AuthContext = createContext({ username: '', role: 'user' });

export function useAuth() {
  return useContext(AuthContext);
}

// super_admin is a strict superset of admin - anywhere that gates on "is this an admin",
// a Super Admin should see/do the same thing a regular admin would.
export function useIsAdmin() {
  const role = useContext(AuthContext).role;
  return role === 'admin' || role === 'super_admin';
}

export function useIsSuperAdmin() {
  return useContext(AuthContext).role === 'super_admin';
}
