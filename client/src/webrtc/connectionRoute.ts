export type ConnectionRoute = 'direct' | 'relay' | 'unknown';

// Inspect the selected pair only; an unused relay candidate does not mean TURN was used.
export function selectedConnectionRoute(reports: RTCStatsReport): ConnectionRoute {
  const all = [...reports.values()];
  const transport = all.find(report => report.type === 'transport' && report.selectedCandidatePairId);
  const pair = transport ? reports.get(transport.selectedCandidatePairId)
    : all.find(report => report.type === 'candidate-pair' && report.state === 'succeeded' && (report.nominated || report.selected));
  if (!pair) return 'unknown';
  const local = reports.get(pair.localCandidateId), remote = reports.get(pair.remoteCandidateId);
  if (local?.candidateType === 'relay' || remote?.candidateType === 'relay') return 'relay';
  return local?.candidateType && remote?.candidateType ? 'direct' : 'unknown';
}

export function connectionRouteLabel(route: ConnectionRoute) {
  return route === 'relay' ? 'TURN relay · encrypted' : route === 'direct' ? 'Direct · encrypted' : 'Connection route unavailable';
}