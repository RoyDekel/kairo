import { createContext, useContext } from 'react';

/*
  The context and its hook live here, apart from AuthProvider.jsx, because
  react-refresh/only-export-components fires when one file exports both a component and
  something else: Fast Refresh can only preserve state for a module whose exports are all
  components, so shipping `useAuth` alongside `AuthProvider` meant every edit to the
  provider did a full remount and dropped the session out of React state mid-session.

  Splitting the non-component exports out fixes that at the cause. AuthProvider.jsx now
  exports exactly one component; everything else consumers need comes from here.
*/
export const AuthContext = createContext(null);

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
