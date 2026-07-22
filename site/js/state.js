export const state = {
  route: null,
  apiStatus: "unknown",
  teams: [],
  selectedTeamId: null,
  sessions: [],
  sessionState: null,
  selectedMemberId: null,
  facilitatorMemberId: null,
  currentRoundNumber: 1,
  initialLoading: false,
  refreshing: false,
  mutating: false,
  error: null,
};

export function setState(patch) {
  Object.assign(state, patch);
  return state;
}

export function resetSessionState() {
  setState({
    sessionState: null,
    selectedMemberId: null,
    facilitatorMemberId: null,
    currentRoundNumber: 1,
    refreshing: false,
    mutating: false,
    error: null,
  });
}
