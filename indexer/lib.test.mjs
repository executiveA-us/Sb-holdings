import test from 'node:test';
import assert from 'node:assert/strict';
import { findWalletTrait, scaleUnits, parseSingleNft, parseBlockscoutTokens } from './lib.mjs';

const A = '0x539cdd042c2f3d93ebc5be7dfff0c79f3b4fabf0';
test('wallet trait auto-detect', () => {
  assert.equal(findWalletTrait([{ trait_type: 'Hat', value: 'red' }, { trait_type: 'Wallet', value: A.toUpperCase().replace('0X', '0x') }]), A);
  assert.equal(findWalletTrait([{ trait_type: 'Hat', value: 'red' }]), null);
});
test('forced trait name', () => {
  const t = [{ trait_type: 'Other', value: A }, { trait_type: 'Wallet', value: '0x' + '1'.repeat(40) }];
  assert.equal(findWalletTrait(t, 'wallet'), '0x' + '1'.repeat(40));
});
test('scaleUnits', () => {
  assert.equal(scaleUnits('1500000000000000000', 18), 1.5);
  assert.equal(scaleUnits('2500000', 6), 2.5);
  assert.equal(scaleUnits('0', 18), 0);
});
test('single nft parse', () => {
  const r = parseSingleNft({ nft: { name: 'x', traits: [{ trait_type: 'w', value: A }], owners: [{ address: A, quantity: 1 }] } });
  assert.equal(r.wallet, A);
  assert.equal(r.owner, A);
});
test('blockscout tokens', () => {
  const r = parseBlockscoutTokens({ items: [{ token: { type: 'ERC-20', symbol: 'T', decimals: '6', address_hash: A, exchange_rate: '2' }, value: '3000000' }, { token: { type: 'ERC-721' }, value: '1' }] });
  assert.equal(r.length, 1);
  assert.equal(r[0].usd, 6);
});
import { parseOpenSeaToken } from './lib.mjs';
test('opensea token quantity is already decimal-adjusted', () => {
  const t = parseOpenSeaToken({ address: A, symbol: 'X', name: 'X', decimals: 18, quantity: '5', usd_value: '2.5' });
  assert.equal(t.quantity, 5);
  assert.equal(t.usd, 2.5);
  assert.equal(parseOpenSeaToken({ symbol: 'Y', decimals: 18, quantity: '232.94', usd_value: '1.04' }).quantity, 232.94);
});

import { traitMap, parseListItem } from './lib.mjs';
test('traitMap drops wallet address trait and empties', () => {
  const m = traitMap([{ trait_type: 'Eyes', value: 'Bull' }, { trait_type: 'Wallet', value: A }, { trait_type: 'X', value: null }]);
  assert.deepEqual(m, { Eyes: 'Bull' });
  assert.deepEqual(parseListItem({ identifier: '1', traits: [{ trait_type: 'Tie', value: 'Red' }] }).traits, { Tie: 'Red' });
});
test('token status kept', () => {
  assert.equal(parseOpenSeaToken({ symbol: 'Z', quantity: '1', status: 'SUSPICIOUS' }).status, 'SUSPICIOUS');
});
