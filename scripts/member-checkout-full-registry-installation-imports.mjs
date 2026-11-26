// Test-driver module interop only. Node/tsx can expose these unchanged TS
// exports as ESM names or through a CJS default. Conflicting exports refuse.
import assert from 'node:assert/strict';
export function nativeCheckoutFinancialExports(submission,points){
 const select=(module,name)=>{
  assert.ok(module&&typeof module==='object');
  const named=module[name],common=module.default?.[name];
  if(named!==undefined)assert.equal(typeof named,'function');
  if(common!==undefined)assert.equal(typeof common,'function');
  if(named!==undefined&&common!==undefined)assert.equal(named,common);
  const value=named??common;assert.equal(typeof value,'function');return value;
 };
 return Object.freeze({submission:Object.freeze({submitMemberCheckout:select(submission,'submitMemberCheckout')}),
  points:Object.freeze(Object.fromEntries(['checkoutSubmissionIdentity','parseCheckoutSubmissionSnapshot','quoteCheckoutSubmissionSnapshot'].map(name=>[name,select(points,name)])))});
}
