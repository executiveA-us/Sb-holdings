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
