// Immutable test data for historical SHA-pinned release policies. Later
// application fixes must not require widening an older publication's pins.
// These fixtures grant no deployment authority and never read Git or network.
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const fixture=JSON.parse(readFileSync(new URL('./reviewed-application-fixtures.json',import.meta.url),'utf8'));
export function readReviewedApplicationFixture(file){
 const entry=fixture.entries[file];
 if(!entry)return readFileSync(new URL('../../'+file,import.meta.url),'utf8').replaceAll('\r\n','\n');
 const bytes=gunzipSync(Buffer.from(entry.gzipBase64,'base64'),{maxOutputLength:2*1024**2});
 if(bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256||bytes.toString('utf8').includes('\r'))throw Error('reviewed_application_fixture_changed');
 return new TextDecoder('utf8',{fatal:true}).decode(bytes);
}
