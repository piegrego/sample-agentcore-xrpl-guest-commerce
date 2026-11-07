# Unit cost analysis

## Scope

This estimate maps the CDK architecture to AWS public pricing in US East
(N. Virginia) as of October 24, 2026. It is a planning model, not a bill. AWS
Free Tier, credits, taxes, data-transfer paths, log volume, model tokens,
Runtime metering, and payment-provider charges can change the result.

The current stack creates:

- one always-on AWS Fargate ARM64 storefront task with 0.25 vCPU and 0.5 GB
  memory;
- one internal Application Load Balancer (ALB);
- one NAT gateway and one associated public IPv4 address;
- one CloudFront distribution with caching disabled;
- three Amazon Bedrock AgentCore Runtimes;
- two AgentCore Memory resources;
- one AgentCore Gateway and one Policy Engine;
- one on-demand DynamoDB table with point-in-time recovery;
- one 512 MB ARM64 Lambda function for operations tools;
- CloudWatch logs, two custom metrics, and two alarms;
- three deployment image assets in Amazon Elastic Container Registry (ECR);
- an XRPL payer secret only when the native-XRP Runtime path is enabled;
- AgentCore Payment Manager resources only when AgentCore Payments is enabled.

The specialist and concierge Runtimes are request-priced. They do not create
an always-on compute floor. The Fargate task, load balancer, NAT gateway, and
public IPv4 address do.

## Current public unit prices

These are public on-demand rates for `us-east-1`. Follow each pricing link
before using the numbers for a budget or production decision.

| Service | Unit used by the demo | Price |
| --- | --- | ---: |
| [AWS Fargate](https://aws.amazon.com/fargate/pricing/) Linux ARM | vCPU-hour | $0.03238 |
| AWS Fargate Linux ARM | GB-hour | $0.00356 |
| [Elastic Load Balancing](https://aws.amazon.com/elasticloadbalancing/pricing/) ALB | ALB-hour | $0.0225 |
| Elastic Load Balancing ALB | load balancer capacity unit (LCU)-hour | $0.008 |
| [Amazon VPC](https://aws.amazon.com/vpc/pricing/) NAT gateway | gateway-hour | $0.045 |
| Amazon VPC NAT gateway | GB processed | $0.045 |
| Amazon VPC public IPv4 | address-hour | $0.005 |
| [CloudFront](https://aws.amazon.com/cloudfront/pricing/) North America | first 10 TB data out, per GB | $0.085 |
| CloudFront North America | 10,000 HTTPS requests | $0.01 |
| [DynamoDB](https://aws.amazon.com/dynamodb/pricing/on-demand/) Standard | 1 million write request units | $0.625 |
| DynamoDB Standard | 1 million read request units | $0.125 |
| DynamoDB Standard | GB-month beyond the first 25 GB | $0.25 |
| DynamoDB point-in-time recovery | GB-month | $0.20 |
| [AgentCore Runtime](https://aws.amazon.com/bedrock/agentcore/pricing/) version 1 | vCPU-hour | $0.0895 |
| AgentCore Runtime version 1 | GB-hour | $0.00945 |
| AgentCore Runtime version 2 consumption | vCPU-hour | $0.1276 |
| AgentCore Runtime version 2 consumption | GB-hour | $0.0169 |
| AgentCore Memory short-term | GB ingested / retrieved | $1.00 / $0.20 |
| AgentCore Memory short-term | GB-month stored | $0.10 |
| AgentCore Memory long-term | 1,000 records stored per month | $0.75 |
| AgentCore Memory long-term | 1,000 records retrieved | $0.50 |
| AgentCore Gateway | 1,000 tool invocations | $0.005 |
| AgentCore Policy | 1,000 authorization requests | $0.025 |
| AgentCore Payments with Coinbase CDP | wallet operation | $0.005 |
| [Amazon Bedrock](https://aws.amazon.com/bedrock/pricing/) Nova Lite | 1,000 input tokens | $0.00006 |
| Amazon Bedrock Nova Lite | 1,000 output tokens | $0.00024 |
| [AWS Secrets Manager](https://aws.amazon.com/secrets-manager/pricing/) | secret-month | $0.40 |
| AWS Secrets Manager | 10,000 API calls | $0.05 |
| [AWS Lambda](https://aws.amazon.com/lambda/pricing/) ARM | 1 million requests | $0.20 |
| AWS Lambda ARM, first duration tier | GB-second | $0.0000133334 |
| [Amazon CloudWatch](https://aws.amazon.com/cloudwatch/pricing/) Logs Standard | GB ingested | $0.50 |
| Amazon CloudWatch custom metrics, first 10,000 | metric-month | $0.30 |
| Amazon CloudWatch standard alarms | alarm metric-month | $0.10 |
| Amazon CloudWatch Container Insights | metric-month | $0.07 |
| [Amazon ECR](https://aws.amazon.com/ecr/pricing/) private storage | GB-month | $0.10 |
| [Amazon Route 53](https://aws.amazon.com/route53/pricing/) private hosted zone | zone-month | $0.50 |

AgentCore Runtime version 2 meters active CPU and active memory separately.
Version 1 meters CPU while code runs and memory for the Runtime duration.
The CDK resource does not pin a pricing generation, so confirm the billed
Runtime dimension in Cost Explorer before applying either rate.

AgentCore Memory applies a 12 KB minimum to each short-term event. Long-term
record charges depend on how many records the configured extraction strategies
create and retrieve.

## Always-on monthly floor

The following baseline assumes 730 hours in a month and an XRPL-enabled stack.
It excludes request-driven AgentCore, Bedrock, Lambda, DynamoDB, CloudFront,
and data-transfer usage.

| Component | Calculation | Monthly estimate |
| --- | --- | ---: |
| Fargate storefront | `730 × ((0.25 × $0.03238) + (0.5 × $0.00356))` | $7.21 |
| Internal ALB fixed charge | `730 × $0.0225` | $16.43 |
| NAT gateway fixed charge | `730 × $0.045` | $32.85 |
| NAT public IPv4 | `730 × $0.005` | $3.65 |
| Route 53 private namespace | one private hosted zone | $0.50 |
| XRPL payer secret | one secret | $0.40 |
| **Fixed subtotal** |  | **$61.04/month** |

The NAT gateway is about 54% of this fixed subtotal. The ALB is about 27%.
The storefront task is about 12%. For an intermittent demo, deleting the stack
when it is not needed saves more than optimizing individual API calls.

The fixed subtotal does not include:

- ALB LCU use;
- NAT data processing and regional or internet data transfer;
- CloudFront requests and data transfer;
- ECR image storage;
- CloudWatch logs, Container Insights, metrics, and alarms;
- DynamoDB storage, recovery storage, and requests;
- AgentCore, Bedrock, Lambda, or Secrets Manager API calls.

## Architectural entries outside the estimate

The estimate covers the recurring services that drive this demo's cost. It
does not assign costs to these conditional, shared, or low-volume entries:

- **CloudFront Function:** CDK creates the viewer-request allowlist only when
  `allowedCidr` is narrower than `0.0.0.0/0` or `allowedIpv6Cidrs` contains a
  prefix. Function executions are not in the scenario estimate.
- **AWS Cloud Map:** The estimate includes the $0.50 Route 53 private hosted
  zone but excludes registered-resource and Cloud Map API-call charges. One
  registered storefront resource would add about $0.10 per month.
- **Route 53 DNS queries:** The estimate excludes private DNS query volume for
  `storefront.agentcore-xrpl.local`.
- **CDK bootstrap storage:** The estimate includes ECR container image storage
  but excludes Amazon S3 storage and requests for deployment assets in the
  shared CDK bootstrap bucket.
- **Additional data transfer:** The estimate includes the stated NAT processing
  and CloudFront delivery volumes but excludes cross-Availability Zone,
  regional, and internet transfer outside those assumptions.
- **DynamoDB index amplification:** The request example uses total billed read
  and write units. It does not separately estimate storage and write units for
  the `settlement-state-updated` global secondary index.
- **Control-plane resources with no separate hourly charge:** The estimate does
  not create line items for AWS Identity and Access Management roles and
  policies, AWS CloudFormation, the virtual private cloud, subnets, route
  tables, security groups, the Amazon ECS cluster, AgentCore Runtime endpoints,
  or AgentCore Payment Manager configuration. Their dependent services and API
  usage remain represented elsewhere in the estimate.

Adding one Cloud Map resource changes the fixed floor from about $61.04 to
about $61.14 per month before DNS queries and shared bootstrap storage. These
entries do not change the primary cost conclusion: NAT gateway and ALB hours
account for $49.28 of the $61.04 major-cost subtotal.

## Request-level formulas

### Standard concierge interaction

Use:

```text
Runtime =
  active_vCPU_hours × runtime_vCPU_rate
  + active_GB_hours × runtime_memory_rate

Model =
  input_tokens / 1,000 × $0.00006
  + output_tokens / 1,000 × $0.00024

Memory =
  ingested_GB × $1.00
  + retrieved_GB × $0.20
  + stored_event_GB_month × $0.10
  + long_term_records_stored / 1,000 × $0.75
  + long_term_records_retrieved / 1,000 × $0.50
```

Example assumption: 5 active vCPU-seconds, 30 GB-seconds of Runtime memory,
3,000 Nova Lite input tokens, and 500 output tokens.

| Item | Version 1 estimate |
| --- | ---: |
| AgentCore Runtime | $0.00020 |
| Nova Lite | $0.00030 |
| **Compute and model subtotal** | **$0.00050 per interaction** |

Memory, networking, logging, and storefront costs are additional. Replace the
example duration and token counts with observed CloudWatch and AgentCore
metrics.

### Specialist investigation

A DevOps or Security investigation adds:

- one specialist Runtime invocation;
- one additional Nova Lite model call;
- usually two Gateway tool invocations;
- one Policy authorization per Gateway tool invocation;
- up to two short operations Lambda calls;
- one operations Memory event and any extracted long-term records.

Two Gateway calls and two Policy decisions cost about `$0.00006` before
Runtime, model, Lambda, Memory, and logs:

```text
2 × ($0.005 / 1,000) + 2 × ($0.025 / 1,000)
```

### AgentCore Payments purchase

AgentCore Payments itself adds no AWS API fee. The current Coinbase CDP
connector charges `$0.005` for each wallet operation performed through
`CreateInstrument` or `ProcessPayment`. A typical purchase has at least one
`ProcessPayment` wallet operation. User onboarding can add a
`CreateInstrument` wallet operation.

This charge excludes:

- the merchant purchase amount;
- network or gas fees;
- connector or provider commercial terms;
- the common Runtime, model, Memory, network, and application costs.

### Native XRP purchase

The XRPL package has no separate AWS service charge. Its marginal AWS cost is
the common Runtime, model, network, DynamoDB, logging, and secret-access use.
The XRPL transaction fee is a ledger cost, not an AWS charge. It varies with
the network and should remain outside the AWS subtotal.

The current DynamoDB request cost per purchase is small. Even ten write request
units and ten read request units are about `$0.0000075`:

```text
10 × $0.625 / 1,000,000 + 10 × $0.125 / 1,000,000
```

## Example demo month

This scenario is an example, not a forecast:

- stack deployed for 730 hours;
- average ALB use of 0.1 LCU;
- 10 GB through the NAT gateway;
- 10 GB delivered through CloudFront;
- 100,000 CloudFront HTTPS requests;
- 1 GB of CloudWatch log ingestion;
- 1 GB in DynamoDB with 1 GB of recovery storage;
- 1.5 GB of ECR image storage;
- two custom payment metrics and two standard alarms;
- 10,000 concierge interactions using the example Runtime and token profile;
- 2,000 long-term Memory records created and 10,000 retrieved;
- 100 AgentCore Payments calls.

| Cost group | Example estimate |
| --- | ---: |
| Fixed subtotal | $61.04 |
| ALB LCU | $0.58 |
| NAT processing | $0.45 |
| CloudFront data and requests | $0.95 |
| ECR image storage | $0.15 |
| DynamoDB recovery storage | $0.20 |
| CloudWatch logs, metrics, and alarms | about $1.30, plus Container Insights observations |
| Concierge Runtime and Nova Lite | about $5.03 |
| AgentCore Memory | about $6.64 |
| AgentCore Payments wallet-provider calls | $0.50 |
| **Illustrative total** | **at least about $76.84/month** |

The estimate excludes merchant payments, XRP or EVM network fees, taxes,
support plans, cross-Region transfer, internet transfer outside the stated
CloudFront volume, and any AWS pricing-plan discounts or credits.

## Cost controls

Near-term cost work should focus on:

1. Destroy demo stacks between events. NAT gateway and ALB hours dominate the
   idle floor.
2. Create a no-NAT development variant only after confirming every Runtime and
   storefront dependency can use VPC endpoints or another supported path.
3. Keep the Fargate storefront at one ARM64 task unless load tests justify more.
4. Set CloudWatch log retention and monitor Container Insights volume.
5. Track model input and output tokens per interaction.
6. Measure AgentCore Runtime active CPU and memory instead of estimating from
   wall-clock latency.
7. Limit Memory extraction and retrieval to records that improve the user
   experience.
8. Keep CloudFront caching disabled only for routes that require dynamic,
   authenticated behavior. Static assets can use a cache behavior.
9. Tag every environment and review Cost Explorer by the
   `Application=AgentCoreXrplPaymentsDemo`
   and `Environment` tags.
10. Separate merchant payment value and blockchain fees from AWS operating
    cost.

## Generate an updated estimate

Use the [AWS Pricing Calculator](https://calculator.aws/#/) and select US East
(N. Virginia). Add:

1. Amazon ECS with one Fargate Linux ARM task: 0.25 vCPU, 0.5 GB, 730
   hours/month.
2. One Application Load Balancer with expected LCU use.
3. One NAT gateway, 730 hours, and expected processed GB.
4. One public IPv4 address, 730 hours.
5. CloudFront with expected North America data transfer and HTTPS requests.
6. DynamoDB on-demand requests, table storage, and point-in-time recovery.
7. Three AgentCore Runtime usage profiles based on measured CPU and memory.
8. AgentCore Memory events, stored records, and retrieved records.
9. AgentCore Gateway invocations and Policy requests.
10. Amazon Bedrock Nova Lite input and output tokens.
11. Lambda operations-tool requests and duration.
12. CloudWatch logs, Container Insights, custom metrics, and alarms.
13. ECR image storage, Route 53 private hosted zone, and Secrets Manager.
14. AgentCore Payments wallet-provider calls when enabled.

The Calculator may not expose every new AgentCore dimension immediately. When
it does not, add those dimensions as a custom line item using the
[AgentCore pricing page](https://aws.amazon.com/bedrock/agentcore/pricing/).
Use [AWS Cost Explorer](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/)
after deployment to replace assumptions with actual service usage.
