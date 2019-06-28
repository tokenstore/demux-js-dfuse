import { AbstractActionReader, ActionReaderOptions, Block } from "demux"
import { gql } from "apollo-boost"
import { getApolloClient, waitUntil } from "../util"
import { DfuseBlockStreamer } from "../dfuse-block-streamer"

type DfuseActionReaderOptions = ActionReaderOptions & {
  dfuseApiKey: string
  network?: string
}

const defaultBlock: Block = {
  blockInfo: {
    blockNumber: 0,
    blockHash: "",
    previousBlockHash: "",
    timestamp: new Date(0)
  },
  actions: []
}
const block1: Block = {
  blockInfo: {
    blockNumber: 1,
    blockHash: "00000001405147477ab2f5f51cda427b638191c66d2c59aa392d5c2c98076cb0",
    previousBlockHash: "",
    timestamp: new Date("2018-06-08T08:08:08.000Z")
  },
  actions: []
}
const block2: Block = {
  blockInfo: {
    blockNumber: 2,
    blockHash: "0000000267f3e2284b482f3afc2e724be1d6cbc1804532ec62d4e7af47c30693",
    previousBlockHash: "00000001405147477ab2f5f51cda427b638191c66d2c59aa392d5c2c98076cb0",
    timestamp: new Date("2018-06-08T08:08:08.000Z")
  },
  actions: []
}

export class DfuseActionReader extends AbstractActionReader {
  protected headInfoInitialized: boolean = false
  protected activeCursor: string = ""
  protected blockQueue: Block[] = []
  protected blockStreamer: DfuseBlockStreamer

  constructor(options: DfuseActionReaderOptions) {
    super(options)

    const { dfuseApiKey, network, startAtBlock } = options

    // Patch for an issue where dfuse doesnt return blocks 1 and 2
    if (this.startAtBlock > 0 && this.startAtBlock < 3) {
      this.startAtBlock = 3
      this.currentBlockNumber = 2
    }

    this.blockStreamer = new DfuseBlockStreamer({
      dfuseApiKey,
      network,
      lowBlockNum: startAtBlock
    })

    this.onBlock = this.onBlock.bind(this)
    this.streamBlocks()
  }

  private onBlock(block: Block, lastIrreversibleBlockNumber: number) {
    /*
     * When we are seeing a new block, we need to update our head reference
     * Math.max is used in case an "undo" trx is returned, with a lower block
     * number than our head reference.
     */
    this.headBlockNumber = Math.max(this.headBlockNumber, block.blockInfo.blockNumber)

    /*
     * Update the reference to the last irreversible block number,
     * making sure we are not receiving an outdated reference in the case of an undo
     ? is this possible?
     */
    this.lastIrreversibleBlockNumber = Math.max(
      this.lastIrreversibleBlockNumber,
      lastIrreversibleBlockNumber
    )

    this.blockQueue.push(block)
  }

  private async streamBlocks(): Promise<void> {
    this.blockStreamer.addOnBlockListener(this.onBlock)
    this.blockStreamer.stream()
  }

  protected async setup(): Promise<void> {
    return
  }

  public async getBlock(blockNumber: number): Promise<Block> {
    // Patch around the issues caused by Dfuse not returning anything for blocks 1 and 2
    if (blockNumber === 1) {
      return block1
    }
    if (blockNumber === 2) {
      return block2
    }

    // If the queue is empty, wait for apollo to return new results.
    await waitUntil(() => this.blockQueue.length > 0)

    const queuedBlock = this.blockQueue[0]
    const queuedBlockNumber = queuedBlock.blockInfo.blockNumber

    if (queuedBlockNumber > blockNumber) {
      // If the first block in the queue is higher than the block we are asking, return a generic block
      this.log.info(`Returning default block for num ${blockNumber}`)
      return defaultBlock
    } else if (queuedBlockNumber === blockNumber) {
      // If the first block in the queue is the one that was requested, return it and remove it from the queue
      this.blockQueue.shift()

      // Hack to make the block's previousHash property match the previous block,
      // if the previous block wasnt returned by dfuse and we had to return a default block
      // todo is there a better solution than this?
      if (this.currentBlockData.blockInfo.blockHash === "") {
        queuedBlock.blockInfo.previousBlockHash = ""
      }
      return queuedBlock
    } else {
      // todo clean this up. this should be handled more gracefully.
      const queuedBlockNumbers = this.blockQueue.map((x) => x.blockInfo.blockNumber)
      throw new Error(
        `Could not find block number ${blockNumber} in queue containing blocks ${queuedBlockNumbers}`
      )
    }
  }

  public async getHeadBlockNumber(): Promise<number> {
    await waitUntil(() => this.headBlockNumber !== 0)
    return this.headBlockNumber
  }

  public async getLastIrreversibleBlockNumber(): Promise<number> {
    await waitUntil(() => this.lastIrreversibleBlockNumber !== 0)
    return this.lastIrreversibleBlockNumber
  }

  // todo do we need to resolve forks, or is dfuse handling all of this for us?
  protected async resolveFork() {
    return
  }
}