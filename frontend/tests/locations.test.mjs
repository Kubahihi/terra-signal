import test from 'node:test'
import assert from 'node:assert/strict'
import { exampleLocationValue, exampleLocations } from '../src/lib/locations.ts'
test('expanded atlas places retain a selected option even when outside the original shortcuts', () => {
 assert.equal(exampleLocationValue(exampleLocations[0]), 'prague')
 assert.equal(exampleLocationValue({id:'paris',name:'Paris, France',lat:48.8566,lon:2.3522}), 'custom')
 assert.equal(exampleLocationValue({id:'paris',name:'Paris, France',lat:48.8566,lon:2.3522}, 'pinned'), 'pinned')
 assert.equal(exampleLocationValue({...exampleLocations[0],lat:0}), 'custom')
})
