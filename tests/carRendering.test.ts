import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { InstancedMesh, Matrix4, Mesh } from 'three';
import { CarModel } from '../src/car/model.ts';
import { CarState } from '../src/car/physics.ts';

test('wheels keep a distinct instanced material and a valid culling bound through steering and spinning', t => {
  const win=new Window(), original=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{value:win.document,configurable:true});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else Reflect.deleteProperty(globalThis,'document');});
  const model=new CarModel(), meshes:Mesh[]=[];
  model.root.traverse(o=>{if(o instanceof Mesh)meshes.push(o);});
  const wheels=meshes.find(m=>m instanceof InstancedMesh) as InstancedMesh;
  assert.ok(wheels.frustumCulled && wheels.boundingSphere);
  assert.ok(meshes.every(m=>m===wheels || m.material!==wheels.material),'no shader variant switching between instanced wheels and ordinary trim');
  const bound=wheels.boundingSphere!.clone(), matrix=new Matrix4(), state=new CarState();
  for(const steer of [-.6,0,.6])for(const spin of [0,1,15]){
    state.steer=steer;state.spin=spin;model.update(state,1/60);
    for(let i=0;i<4;i++){
      wheels.getMatrixAt(i,matrix);
      const sphere=wheels.geometry.boundingSphere!.clone().applyMatrix4(matrix);
      assert.ok(bound.center.distanceTo(sphere.center)+sphere.radius <= bound.radius+1e-6,'animated wheel remains inside the static bound');
    }
  }
});
