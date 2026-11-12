import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarPhysics } from '../src/car/physics.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { aiPace } from '../src/race/ai.ts';
import { RacingDriver } from '../src/race/driver.ts';
import { Racecraft, type Rival } from '../src/race/racecraft.ts';
import { TrafficPlanner } from '../src/race/traffic.ts';
import { brakingBends } from './helpers/traffic.ts';
import { cornerDuel } from './helpers/racecraft.ts';

function duel() {
  const track = getSampleTrack(1), driver = new RacingDriver(track, aiPace(0.9, track));
  const bend = brakingBends(track, driver)[0], side = driver.curvatureAt(bend.apex) < 0 ? 1 : -1;
  const car = new CarPhysics(track), rival = new CarPhysics(track);
  car.placeAt(bend.brake - 50, -side * 3); rival.placeAt(bend.brake - 50, side * 2.5);
  car.state.speed = rival.state.speed = 25;
  const near: Rival = { car: rival.state, ds: 0, lat: rival.state.lateral, v: 25, drift: 0, ai: false };
  const corner = { brake: 50, apex: bend.apex - (bend.brake - 50), side };
  return { track, driver, bend, side, car, rival, near, corner, craft: new Racecraft(driver, track.center.length) };
}

test('racecraft commits to the outside instead of surrendering a legitimate overlap', () => {
  const d = duel();
  d.craft.plan(d.car.state, [d.near], d.corner, true, true);
  assert.equal(d.craft.action, 'hold-outside');
  const path = d.craft.path;
  for (let i = 0; i < 30; i++) {
    d.near.ds = i % 2 ? -0.8 : 0.8;
    d.craft.plan(d.car.state, [d.near], null, true, true);
    assert.equal(d.craft.action, 'hold-outside');
    assert.equal(d.craft.path, path);
  }
  assert.ok((d.driver.lateralAt(d.bend.apex) - d.craft.path(d.bend.apex)) * d.side > 2.5, 'keeps an outside lane through the apex');
});

test('racecraft switches back behind a rival running wide, then attacks the exit', () => {
  const d = duel(); d.craft.plan(d.car.state, [d.near], d.corner, true, true);
  d.car.placeAt(d.bend.apex - 14, -d.side * 3); d.car.state.speed = 20;
  d.rival.placeAt(d.car.state.s + 8, -d.side * 3); d.rival.state.speed = 21;
  Object.assign(d.near, { ds: 8, lat: d.rival.state.lateral, drift: -d.side, v: 21 });
  d.craft.plan(d.car.state, [d.near], null, true, true);
  assert.equal(d.craft.action, 'switchback');
  const now = d.craft.path(d.car.state.s), later = d.craft.path(d.car.state.s + 24);
  assert.ok((later - now) * d.side > 2, 'late apex crosses into the freed inside lane');
  d.car.placeAt(d.bend.apex + 10, d.side * 3); d.car.state.speed = 23;
  d.craft.plan(d.car.state, [d.near], null, true, true);
  assert.equal(d.craft.action, 'exit-attack');
});

test('racecraft never cuts across a rival still alongside or a third car occupying the inside', () => {
  for (const thirdCar of [false, true]) {
    const d = duel(); d.craft.plan(d.car.state, [d.near], d.corner, true, true);
    d.car.placeAt(d.bend.apex - 14, -d.side * 3); d.car.state.speed = 20;
    Object.assign(d.near, { ds: thirdCar ? 8 : 2, lat: -d.side * 3, drift: -d.side });
    const blocker = new CarPhysics(d.track); blocker.placeAt(d.car.state.s + 1, d.side * 2.5);
    const rivals = thirdCar ? [d.near, { ...d.near, car: blocker.state, ds: 1, lat: blocker.state.lateral }] : [d.near];
    d.craft.plan(d.car.state, rivals, null, true, true);
    assert.equal(d.craft.action, 'hold-outside');
  }
});

test('racecraft takes an open inside before turn-in and respects race-control suspension', () => {
  const d = duel(); d.car.placeAt(d.bend.brake - 40, d.side * 3); d.car.state.speed = 25;
  Object.assign(d.near, { ds: 5, lat: -d.side * 3, v: 24 });
  d.craft.plan(d.car.state, [d.near], { ...d.corner, brake: 40 }, true, true);
  assert.equal(d.craft.action, 'attack-inside');
  d.craft.plan(d.car.state, [d.near], null, true, false);
  assert.equal(d.craft.action, 'racing-line');
});

test('racecraft does not invent a late dive, act on the opening AI pack or retain a missing rival', () => {
  for (const reason of ['late', 'pack', 'missing'] as const) {
    const d = duel();
    if (reason === 'late') d.corner.brake = 0;
    if (reason === 'pack') d.near.ai = true;
    d.craft.plan(d.car.state, [d.near], d.corner, reason !== 'pack', true);
    if (reason === 'missing') d.craft.plan(d.car.state, [], null, true, true);
    assert.equal(d.craft.action, 'racing-line');
  }
});

test('racecraft races matched AI cars but preserves the let-by contract for different pace levels', () => {
  for (const matched of [true, false]) {
    const d = duel();
    d.near.ai = true;
    const rival = { ...d.near, pace: matched ? 1 : 0.6 };
    d.craft.plan(d.car.state, [rival], d.corner, true, true);
    assert.equal(d.craft.action, matched ? 'hold-outside' : 'racing-line');
  }
});

test('racecraft keeps its corner commitment across the start line and releases after the exit', () => {
  const d = duel(), length = d.track.center.length;
  d.car.placeAt(length - 50, -d.side * 3); d.car.state.speed = 25;
  d.rival.placeAt(length - 50, d.side * 3); d.rival.state.speed = 25;
  Object.assign(d.near, { ds: 0, lat: d.rival.state.lateral });
  d.craft.plan(d.car.state, [d.near], { brake: 20, apex: 80, side: d.side }, true, true);
  assert.equal(d.craft.action, 'hold-outside');
  assert.ok(Math.abs(d.craft.path(30) - d.craft.path(length + 30)) < 1e-8);
  d.car.placeAt(20, -d.side * 3); d.car.state.speed = 25;
  d.craft.plan(d.car.state, [d.near], null, true, true);
  assert.equal(d.craft.action, 'hold-outside');
  d.car.placeAt(100, -d.side * 3); d.car.state.speed = 25;
  d.craft.plan(d.car.state, [d.near], null, true, true);
  assert.equal(d.craft.action, 'racing-line');
});

test('live AI contests an outside overlap through a hairpin using actual physics', () => {
  const run = cornerDuel(1, 0, 'inside');
  assert.ok(run.actions['hold-outside'] > 120, 'commits to the outside for more than one second');
  assert.ok(run.peakOverlapSeconds > 2.5, 'races alongside rather than immediately yielding');
  assert.equal(run.contacts, 0); assert.equal(run.off, 0); assert.equal(run.resets, 0);
});

test('live AI completes a switchback when a player takes an early apex and runs wide', () => {
  const run = cornerDuel(0, 6, 'wide-exit');
  assert.ok(run.actions.switchback > 0 && run.actions['exit-attack'] > 0);
  assert.ok(run.finalGap < -5, 'actually passes and clears the player on exit');
  assert.equal(run.contacts, 0); assert.equal(run.off, 0); assert.equal(run.resets, 0);
});

test('live AI avoids a faster player cutting across its front wheel before clearing the overlap', () => {
  const run = cornerDuel(2, 6, 'inside');
  assert.equal(run.contacts, 0);
  assert.equal(run.off, 0); assert.equal(run.resets, 0);
});

test('inside defence responds to a realistic threat before a braking corner, never a reactive block', () => {
  const track = getSampleTrack(1), driver = new RacingDriver(track, aiPace(0.9, track));
  const bend = brakingBends(track, driver)[0], me = new CarPhysics(track), player = new CarPhysics(track);
  let defended = false;
  for (let before = 140; before >= 35; before -= 5) {
    const s = bend.brake - before;
    me.placeAt(s, driver.lateralAt(s)); me.state.speed = driver.speedAt(s);
    player.placeAt(s - 11.2, driver.lateralAt(s - 11.2)); player.state.speed = me.state.speed + 0.5;
    const planner = new TrafficPlanner(driver, track, 0.9);
    planner.plan(me.state, [me.state, player.state], 0);
    defended ||= planner.action === 'defend-inside';
  }
  assert.ok(defended, 'covers the inside with a seven-metre bumper gap, before braking');
  const side = driver.curvatureAt(bend.apex) < 0 ? 1 : -1;
  const s = bend.brake - 100;
  me.placeAt(s, -side * 3); me.state.speed = driver.speedAt(s);
  player.placeAt(s - 1, side * 3); player.state.speed = me.state.speed;
  const planner = new TrafficPlanner(driver, track, 0.9);
  planner.plan(me.state, [me.state, player.state], me.state.lateral - driver.lateralAt(s));
  assert.notEqual(planner.action, 'defend-inside', 'does not block a car already alongside on the inside');
});
