// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TipRegistry} from "../src/TipRegistry.sol";

contract TipRegistryTest {
    bytes32 private constant SUBJECT = keccak256("git:github.com/NousResearch/hermes-agent");
    bytes32 private constant VERSION = keccak256("commit:abc123");
    bytes32 private constant POLICY = keccak256("tip.git.tracked-source.v1");
    bytes32 private constant ROOT = keccak256("root");

    function testOwnerIsInitialPublisher() public {
        TipRegistry registry = new TipRegistry(address(this));
        assert(registry.owner() == address(this));
        assert(registry.publishers(address(this)));
    }

    function testOwnerCanAddPublisher() public {
        TipRegistry registry = new TipRegistry(address(this));
        address publisher = address(0xBEEF);
        registry.setPublisher(publisher, true);
        assert(registry.publishers(publisher));
    }

    function testAllowedPublisherCanPublish() public {
        TipRegistry registry = new TipRegistry(address(this));
        registry.publishRoot(SUBJECT, VERSION, POLICY, ROOT, "ipfs://manifest", "ipfs://metadata");
        (
            bytes32 root,
            ,
            ,
            address publisher,
            ,
            bool revoked
        ) = registry.getRoot(SUBJECT, VERSION, POLICY);
        assert(root == ROOT);
        assert(publisher == address(this));
        assert(!revoked);
    }

    function testNonPublisherCannotPublish() public {
        TipRegistry registry = new TipRegistry(address(this));
        NonPublisher attacker = new NonPublisher(registry);
        try attacker.publish(SUBJECT, VERSION, POLICY, ROOT) {
            assert(false);
        } catch (bytes memory reason) {
            bytes4 selector;
            assembly {
                selector := mload(add(reason, 32))
            }
            assert(selector == TipRegistry.NotPublisher.selector);
        }
    }

    function testDuplicatePublishReverts() public {
        TipRegistry registry = new TipRegistry(address(this));
        registry.publishRoot(SUBJECT, VERSION, POLICY, ROOT, "ipfs://manifest", "");
        try registry.publishRoot(SUBJECT, VERSION, POLICY, ROOT, "ipfs://manifest", "") {
            assert(false);
        } catch (bytes memory reason) {
            bytes4 selector;
            assembly {
                selector := mload(add(reason, 32))
            }
            assert(selector == TipRegistry.RootAlreadyPublished.selector);
        }
    }

    function testOwnerCanRevokeRoot() public {
        TipRegistry registry = new TipRegistry(address(this));
        registry.publishRoot(SUBJECT, VERSION, POLICY, ROOT, "ipfs://manifest", "");
        registry.revokeRoot(SUBJECT, VERSION, POLICY, "ipfs://reason");
        (
            ,
            ,
            ,
            ,
            ,
            bool revoked
        ) = registry.getRoot(SUBJECT, VERSION, POLICY);
        assert(revoked);
    }

    function testLatestRootTracksNewestPublish() public {
        TipRegistry registry = new TipRegistry(address(this));
        bytes32 version2 = keccak256("commit:def456");
        bytes32 root2 = keccak256("root2");
        registry.publishRoot(SUBJECT, VERSION, POLICY, ROOT, "ipfs://one", "");
        registry.publishRoot(SUBJECT, version2, POLICY, root2, "ipfs://two", "");
        (
            bytes32 latestVersion,
            bytes32 latestRoot,
            ,
            ,
            ,
            ,

        ) = registry.getLatestRoot(SUBJECT, POLICY);
        assert(latestVersion == version2);
        assert(latestRoot == root2);
    }
}

contract NonPublisher {
    TipRegistry private immutable registry;

    constructor(TipRegistry registry_) {
        registry = registry_;
    }

    function publish(bytes32 subject, bytes32 version, bytes32 policy, bytes32 root) external {
        registry.publishRoot(subject, version, policy, root, "", "");
    }
}
