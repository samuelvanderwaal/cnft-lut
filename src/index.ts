import {
  burn,
  createTree,
  fetchMerkleTree,
  getCurrentRoot,
  hashMetadataCreators,
  hashMetadataData,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  generateSigner,
  keypairIdentity,
  transactionBuilder,
} from "@metaplex-foundation/umi";
import { createLut } from "@metaplex-foundation/mpl-toolbox";
import bs58 from "bs58";
import fs from "fs";
import { createUmi, mint } from "./setup";
import { SystemProgram } from "@solana/web3.js";
import { fromWeb3JsPublicKey } from "@metaplex-foundation/umi-web3js-adapters";

const NUM_ITEMS = 17;

async function main() {
  const umi = await createUmi("http://127.0.0.1:8899");

  // Import your private key file and parse it.
  const wallet = "./keypair.json";
  const secretKey = JSON.parse(fs.readFileSync(wallet, "utf-8"));

  // Register it to the Umi client.
  const keypair = umi.eddsa.createKeypairFromSecretKey(
    new Uint8Array(secretKey),
  );

  // Register it to the Umi client.
  umi.use(keypairIdentity(keypair));

  const merkleTree = generateSigner(umi);

  const recentSlot = await umi.rpc.getSlot({ commitment: "confirmed" });
  console.log("Creating tree...");
  const res = await (
    await createTree(umi, {
      merkleTree,
      maxDepth: 14,
      maxBufferSize: 64,
      canopyDepth: 14,
    })
  ).sendAndConfirm(umi);

  const sig = bs58.encode(res.signature);
  console.log(sig);

  let merkleTreeAccount = await fetchMerkleTree(umi, merkleTree.publicKey);

  const lutAddresses = [
    umi.identity.publicKey,
    merkleTree.publicKey,
    fromWeb3JsPublicKey(SystemProgram.programId),
    SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    SPL_NOOP_PROGRAM_ID,
  ];

  console.log("creating lut");
  const [lutBuilder, addressLookupTableInput] = createLut(umi, {
    authority: umi.identity,
    recentSlot,
    addresses: lutAddresses,
  });
  const lutResult = await lutBuilder.sendAndConfirm(umi);
  console.log(bs58.encode(lutResult.signature));

  const assets = [];

  for (let i = 0; i < NUM_ITEMS; i++) {
    console.log("Minting...");
    const asset = await mint(umi, {
      merkleTree: merkleTree.publicKey,
      leafIndex: i,
    });
    assets.push(asset);
  }

  let builder = transactionBuilder();

  for (let i = 0; i < NUM_ITEMS; i++) {
    const { metadata, leafIndex } = assets[i];
    builder = builder.add(
      burn(umi, {
        leafOwner: umi.identity.publicKey,
        merkleTree: merkleTree.publicKey,
        root: getCurrentRoot(merkleTreeAccount.tree),
        dataHash: hashMetadataData(metadata),
        creatorHash: hashMetadataCreators(metadata.creators),
        nonce: leafIndex,
        index: leafIndex,
        proof: [],
      }),
    );
  }

  builder = builder.setAddressLookupTables([addressLookupTableInput]);
  console.log(builder.items);
  console.log(builder.fitsInOneTransaction(umi));
  const builders = builder.unsafeSplitByTransactionSize(umi);

  console.log(`builders split into ${builders.length} transactions`);

  console.log("burning...");
  const promises = builders.map((builder) => builder.sendAndConfirm(umi));
  Promise.all(promises).then((results) =>
    results.map((r) => console.log(bs58.encode(r.signature))),
  );
}

main().catch(console.error);
