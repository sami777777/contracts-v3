import { NetworkToken } from '../../components/LegacyContracts';
import { TestVault } from '../../typechain';
import { expectRole, roles } from '../helpers/AccessControl';
import { NATIVE_TOKEN_ADDRESS } from '../helpers/Constants';
import { createSystem } from '../helpers/Factory';
import { shouldHaveGap } from '../helpers/Proxy';
import { transfer, getBalance } from '../helpers/Utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

const { Upgradeable: UpgradeableRoles } = roles;

let deployer: SignerWithAddress;
let sender: SignerWithAddress;
let target: SignerWithAddress;
let admin: SignerWithAddress;

describe('TestVault', () => {
    shouldHaveGap('TestVault');

    before(async () => {
        [deployer, sender, target, admin] = await ethers.getSigners();
    });

    describe('construction', () => {
        it('should revert when attempting to reinitialize', async () => {
            const { testVault } = await createSystem();

            await expect(testVault.initialize()).to.be.revertedWith('Initializable: contract is already initialized');
        });

        it('should be properly initialized', async () => {
            const { testVault } = await createSystem();

            expect(await testVault.version()).to.equal(1);
            expect(await testVault.isPayable()).to.be.true;
            await expectRole(testVault, UpgradeableRoles.ROLE_ADMIN, UpgradeableRoles.ROLE_ADMIN, [deployer.address]);
        });
    });

    describe('withdrawing funds', async () => {
        let testVault: TestVault;
        let networkToken: NetworkToken;

        beforeEach(async () => {
            ({ testVault, networkToken } = await createSystem());
        });

        const testWithdraw = async (token: string) => {
            const amount = 1_000_000;

            await transfer(deployer, { address: token }, testVault.address, amount);

            const currentBalance = await getBalance({ address: token }, target);

            await expect(testVault.withdrawFunds(token, target.address, amount))
                .to.emit(testVault, 'FundsWithdrawn')
                .withArgs(token, deployer.address, target.address, amount);

            expect(await getBalance({ address: token }, target)).to.equal(currentBalance.add(amount));
        };

        it('with ETH', async () => await testWithdraw(NATIVE_TOKEN_ADDRESS));

        it('with tokens', async () => await testWithdraw(networkToken.address));

        context('when paused', () => {
            it('should succeed when contract is not paused', async () => {
                await expect(testVault.withdrawFunds(networkToken.address, target.address, 0)).to.not.reverted;
            });

            it('should fail when contract is paused', async () => {
                await testVault.pause();

                await expect(testVault.withdrawFunds(networkToken.address, target.address, 0)).to.revertedWith(
                    'Pausable: paused'
                );
            });
        });
    });

    describe('pausing/unpausing', () => {
        let testVault: TestVault;

        beforeEach(async () => {
            ({ testVault } = await createSystem());
        });

        const testPause = () => {
            it('should pause the contract', async () => {
                await testVault.connect(sender).pause();

                expect(await testVault.isPaused()).to.be.true;
            });

            context('when paused', () => {
                beforeEach(async () => {
                    await testVault.connect(deployer).grantRole(UpgradeableRoles.ROLE_ADMIN, admin.address);
                    await testVault.connect(admin).pause();

                    expect(await testVault.isPaused()).to.be.true;
                });

                it('should unpause the contract', async () => {
                    await testVault.connect(sender).unpause();

                    expect(await testVault.isPaused()).to.be.false;
                });
            });
        };

        const testPauseRestricted = () => {
            it('should revert when a non-admin is attempting to pause', async () => {
                await expect(testVault.connect(sender).pause()).to.be.revertedWith('AccessDenied');
            });

            context('when paused', () => {
                beforeEach(async () => {
                    await testVault.connect(deployer).grantRole(UpgradeableRoles.ROLE_ADMIN, admin.address);
                    await testVault.connect(admin).pause();

                    expect(await testVault.isPaused()).to.be.true;
                });

                it('should revert when a non-admin is attempting unpause', async () => {
                    await expect(testVault.connect(sender).unpause()).to.be.revertedWith('AccessDenied');
                });
            });
        };

        context('admin', () => {
            beforeEach(async () => {
                await testVault.connect(deployer).grantRole(UpgradeableRoles.ROLE_ADMIN, sender.address);
            });

            testPause();
        });

        context('regular account', () => {
            testPauseRestricted();
        });
    });
});
