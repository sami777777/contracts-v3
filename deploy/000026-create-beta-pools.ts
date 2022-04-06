import Contracts from '../components/Contracts';
import { PoolType } from '../utils/Constants';
import { DeployedContracts, execute, InstanceName, isMainnetFork, setDeploymentMetadata } from '../utils/Deploy';
import { NATIVE_TOKEN_ADDRESS } from '../utils/TokenData';
import { toPPM, toWei } from '../utils/Types';
import { BigNumber } from 'ethers';
import { ethers } from 'hardhat';
import { DeployFunction } from 'hardhat-deploy/types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

// TODO: make sure to update the limits and the rates before running the script in production
const CENTS = 100;
const BNT_TOKEN_PRICE_IN_CENTS = 2.7 * CENTS;

const TRADING_FEE = toPPM(0.2);
const MIN_LIQUIDITY_FOR_TRADING = toWei(10_000);

enum BetaTokens {
    ETH = 'ETH',
    DAI = 'DAI',
    LINK = 'LINK'
}

const BETA_TOKEN_PRICES_IN_CENTS = {
    [BetaTokens.ETH]: 3266 * CENTS,
    [BetaTokens.DAI]: 1 * CENTS,
    [BetaTokens.LINK]: 15.67 * CENTS
};

const TKN_DEPOSIT_LIMIT_IN_CENTS = 171_000 * CENTS;
const BNT_FUNDING_LIMIT_IN_CENTS = 156_000 * CENTS;
const FUNDING_LIMIT = toWei(BNT_FUNDING_LIMIT_IN_CENTS).div(BNT_TOKEN_PRICE_IN_CENTS);

const func: DeployFunction = async ({ getNamedAccounts }: HardhatRuntimeEnvironment) => {
    const { deployer, dai, link, ethWhale, daiWhale, linkWhale } = await getNamedAccounts();

    const BETA_TOKENS = {
        [BetaTokens.ETH]: {
            address: NATIVE_TOKEN_ADDRESS,
            whale: ethWhale
        },
        [BetaTokens.DAI]: {
            address: dai,
            whale: daiWhale
        },
        [BetaTokens.LINK]: {
            address: link,
            whale: linkWhale
        }
    };

    const network = await DeployedContracts.BancorNetwork.deployed();

    for (const [tokenSymbol, { address, whale }] of Object.entries(BETA_TOKENS)) {
        const isNativeToken = tokenSymbol === BetaTokens.ETH;

        await execute({
            name: InstanceName.NetworkSettings,
            methodName: 'addTokenToWhitelist',
            args: [address],
            from: deployer
        });

        await execute({
            name: InstanceName.BancorNetwork,
            methodName: 'createPool',
            args: [PoolType.Standard, address],
            from: deployer
        });

        await execute({
            name: InstanceName.NetworkSettings,
            methodName: 'setFundingLimit',
            args: [address, FUNDING_LIMIT],
            from: deployer
        });

        const tokenPriceInCents = BETA_TOKEN_PRICES_IN_CENTS[tokenSymbol as BetaTokens];
        const depositLimit = toWei(TKN_DEPOSIT_LIMIT_IN_CENTS).div(tokenPriceInCents);

        await execute({
            name: InstanceName.PoolCollectionType1V1,
            methodName: 'setDepositLimit',
            args: [address, depositLimit],
            from: deployer
        });

        await execute({
            name: InstanceName.PoolCollectionType1V1,
            methodName: 'setTradingFeePPM',
            args: [address, TRADING_FEE],
            from: deployer
        });

        if (isMainnetFork()) {
            const bntVirtualPrice = tokenPriceInCents;
            const tokenVirtualPrice = BNT_TOKEN_PRICE_IN_CENTS;
            const initialDeposit = MIN_LIQUIDITY_FOR_TRADING.mul(tokenVirtualPrice).div(bntVirtualPrice).mul(3);

            if (!isNativeToken) {
                const token = await Contracts.ERC20.attach(address);
                await token.connect(await ethers.getSigner(whale)).approve(network.address, initialDeposit);
            }

            await execute({
                name: InstanceName.BancorNetwork,
                methodName: 'deposit',
                args: [address, initialDeposit],
                from: whale,
                value: isNativeToken ? initialDeposit : BigNumber.from(0)
            });

            await execute({
                name: InstanceName.PoolCollectionType1V1,
                methodName: 'enableTrading',
                args: [address, bntVirtualPrice, tokenVirtualPrice],
                from: deployer
            });
        }
    }

    return true;
};

export default setDeploymentMetadata(__filename, func);
