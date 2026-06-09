import { loadLocalEnv } from "../server/env.js";
import { getBrokerStatus, testChiefConfig, testFutuOpenD, testIbkrGateway, testTigerConfig } from "../server/brokers.js";

await loadLocalEnv();

const command = process.argv[2] || "status";

if (command === "futu") {
  console.log(JSON.stringify(await testFutuOpenD(), null, 2));
} else if (command === "tiger") {
  console.log(JSON.stringify(await testTigerConfig(), null, 2));
} else if (command === "ibkr") {
  console.log(JSON.stringify(await testIbkrGateway(), null, 2));
} else if (command === "chief") {
  console.log(JSON.stringify(await testChiefConfig(), null, 2));
} else {
  console.log(JSON.stringify(await getBrokerStatus(), null, 2));
}
