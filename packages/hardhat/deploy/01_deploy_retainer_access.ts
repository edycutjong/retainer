import * as fs from "fs";
import * as path from "path";

import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";

import { getDeployGasPrice } from "../utils/getDeployGasPrice";
import { resolveHederaContractId } from "../utils/resolveHederaContractId";

const HEDERA_CHAIN_IDS = new Set([295, 296]);

const deployRetainerAccess: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // The seller's terms, set at deploy time and changeable later via `setTerms`. The
  // subscriber never chooses the price: letting them do so meant 2 tinybar bought a full
  // access window while burning 2 HBAR of the seller's gas reserve.
  const pricePerPeriod = process.env.RETAINER_PRICE_TINYBAR ?? "100000000"; // 1 HBAR
  const periodSeconds = Number(process.env.RETAINER_PERIOD_SECONDS ?? 3600); // 1 hour
  // What a period buys. The charge is metered, not flat: a period is a countable quantity of
  // the feed, and the unattended renewal is what refills it.
  const callsPerPeriod = Number(process.env.RETAINER_CALLS_PER_PERIOD ?? 25);

  // The beneficiary collects charged periods. Deployer by default.
  //
  // The reserve is funded by a SEPARATE transaction below, not by a deploy value. Hedera credits
  // a contract-create's initial balance at the HAPI level, outside the EVM frame, so a payable
  // constructor sees msg.value == 0 while the contract really does hold the money — it arrives
  // and is never booked. Funding with an ordinary call avoids that entirely.
  const deployment = await deploy("RetainerAccess", {
    from: deployer,
    args: [deployer, pricePerPeriod, periodSeconds, callsPerPeriod],
    log: true,
    autoMine: true,
    gasLimit: "4000000",
    gasPrice: await getDeployGasPrice(hre),
  });

  // The network charges the CONTRACT for each scheduled renewal (~1.55 HBAR measured on
  // testnet), so a self-renewing contract has to hold gas for its own future. Seed ~4.
  const reserveHbar = process.env.RETAINER_RESERVE_HBAR ?? "8";
  if (deployment.newlyDeployed) {
    const signer = await hre.ethers.getSigner(deployer);
    const c = await hre.ethers.getContractAt("RetainerAccess", deployment.address, signer);
    // Value on the wire is weibar (1e18); the EVM will see tinybar (1e8).
    const tx = await c.fundGasReserve({ value: hre.ethers.parseEther(reserveHbar), gasLimit: 200_000 });
    await tx.wait();
    console.log(`Funded gas reserve with ${reserveHbar} HBAR — arms ${await c.renewalsRemaining()} renewals`);
  }

  const chainId = Number(await hre.network.provider.send("eth_chainId", []));

  if (HEDERA_CHAIN_IDS.has(chainId) && deployment.address) {
    const hederaContractId = await resolveHederaContractId(deployment.address, chainId);
    const deploymentPath = path.join(hre.config.paths.deployments, hre.network.name, "RetainerAccess.json");
    const deploymentJson = JSON.parse(fs.readFileSync(deploymentPath, "utf8")) as Record<string, unknown>;
    deploymentJson.hederaContractId = hederaContractId;
    fs.writeFileSync(deploymentPath, `${JSON.stringify(deploymentJson, null, 2)}\n`);
    console.log(`Resolved Hedera contract id: ${hederaContractId}`);
  }
};

deployRetainerAccess.tags = ["RetainerAccess"];
export default deployRetainerAccess;
