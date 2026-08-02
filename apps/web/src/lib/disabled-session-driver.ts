const SESSIONS_DISABLED = "Astro sessions are disabled by QuantClarity policy.";

function rejectSessionAccess(): Promise<never> {
  return Promise.reject(new Error(SESSIONS_DISABLED));
}

export default function disabledSessionDriver() {
  return {
    getItem: rejectSessionAccess,
    removeItem: rejectSessionAccess,
    setItem: rejectSessionAccess,
  };
}
