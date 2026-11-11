import type { DrivingEnv } from './env.ts';

export function raceMetrics(env: DrivingEnv) {
  return {
    simulatedSeconds: env.tick / 120,
    field: env.agents.length,
    finishers: env.agents.filter((a) => a.session.phase === 'finished' && !a.session.retired).length,
    retirements: env.agents.filter((a) => a.session.retired).length,
    firmContacts: env.firmContacts,
    hardContacts: env.hardContacts,
    playerContacts: env.playerContacts,
    order: env.order(),
    cars: env.agents.map((a, index) => ({
      index, difficulty: a.spec.difficulty, brain: a.spec.brain,
      distance: a.distance, laps: [...a.session.laps], valid: [...a.session.lapValid],
      best: a.session.best?.time ?? null, finish: a.session.runEnd,
      offSeconds: a.offSeconds, hardContacts: a.hardContacts, highSpeedWallHits: a.wallHits, resets: a.resets,
    })),
  };
}

/** Gates that phase 0/1 diagnostics cannot establish must never appear as passing zeroes. */
export function pendingGates() {
  return {
    status: 'not eligible for promotion',
    heldOutPace: 'not measured', validLaps98Percent: 'not measured',
    fullFieldTenLaps: 'not measured', playerFairness: 'not measured',
    pits100Percent: 'not measured', conditions: 'not measured',
    calibratedDifficulty: 'not measured', browserNodeParity: 'not measured',
    runtimeBudget: 'not measured', quantizedExport: 'not measured',
  };
}
