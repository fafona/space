import {runOwnedActivePublicationProtocolChild} from './release-toolchain-active-generation-publication-native.mjs';
try{if(process.argv.length!==4)throw Error('owned_publication_protocol_arguments');await runOwnedActivePublicationProtocolChild(process.argv[2],process.argv[3]);}catch{console.error('owned_publication_protocol_unconfirmed_evidence_preserved');process.exitCode=1;}
