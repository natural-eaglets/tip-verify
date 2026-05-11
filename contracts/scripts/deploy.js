import hre from "hardhat";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Deploying TipRegistry from ${deployer.address}`);
  const TipRegistry = await hre.ethers.getContractFactory("TipRegistry");
  const registry = await TipRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  const address = await registry.getAddress();
  console.log(`TipRegistry deployed to ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
