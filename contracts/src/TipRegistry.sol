// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TipRegistry {
    struct RootRecord {
        bytes32 root;
        string manifestURI;
        string metadataURI;
        address publisher;
        uint64 timestamp;
        bool revoked;
    }

    struct LatestRecord {
        bytes32 versionId;
        RootRecord record;
    }

    error NotOwner();
    error NotPublisher();
    error ZeroAddress();
    error EmptyRoot();
    error EmptySubject();
    error EmptyVersion();
    error EmptyPolicy();
    error RootAlreadyPublished();
    error RootNotFound();
    error RootAlreadyRevoked();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PublisherUpdated(address indexed publisher, bool allowed);
    event RootPublished(
        bytes32 indexed subjectId,
        bytes32 indexed versionId,
        bytes32 indexed policyId,
        bytes32 root,
        string manifestURI,
        string metadataURI,
        address publisher
    );
    event RootRevoked(
        bytes32 indexed subjectId,
        bytes32 indexed versionId,
        bytes32 indexed policyId,
        string reasonURI,
        address revoker
    );

    address public owner;
    mapping(address publisher => bool allowed) public publishers;

    mapping(bytes32 subjectId => mapping(bytes32 versionId => mapping(bytes32 policyId => RootRecord record))) private records;
    mapping(bytes32 subjectId => mapping(bytes32 policyId => LatestRecord latest)) private latestRecords;

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        owner = initialOwner;
        publishers[initialOwner] = true;
        emit OwnershipTransferred(address(0), initialOwner);
        emit PublisherUpdated(initialOwner, true);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPublisher() {
        if (!publishers[msg.sender]) revert NotPublisher();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function setPublisher(address publisher, bool allowed) external onlyOwner {
        if (publisher == address(0)) revert ZeroAddress();
        publishers[publisher] = allowed;
        emit PublisherUpdated(publisher, allowed);
    }

    function publishRoot(
        bytes32 subjectId,
        bytes32 versionId,
        bytes32 policyId,
        bytes32 root,
        string calldata manifestURI,
        string calldata metadataURI
    ) external onlyPublisher {
        if (subjectId == bytes32(0)) revert EmptySubject();
        if (versionId == bytes32(0)) revert EmptyVersion();
        if (policyId == bytes32(0)) revert EmptyPolicy();
        if (root == bytes32(0)) revert EmptyRoot();

        RootRecord storage existing = records[subjectId][versionId][policyId];
        if (existing.timestamp != 0) revert RootAlreadyPublished();

        RootRecord memory record = RootRecord({
            root: root,
            manifestURI: manifestURI,
            metadataURI: metadataURI,
            publisher: msg.sender,
            timestamp: uint64(block.timestamp),
            revoked: false
        });

        records[subjectId][versionId][policyId] = record;
        latestRecords[subjectId][policyId] = LatestRecord({
            versionId: versionId,
            record: record
        });

        emit RootPublished(subjectId, versionId, policyId, root, manifestURI, metadataURI, msg.sender);
    }

    function revokeRoot(
        bytes32 subjectId,
        bytes32 versionId,
        bytes32 policyId,
        string calldata reasonURI
    ) external onlyOwner {
        RootRecord storage record = records[subjectId][versionId][policyId];
        if (record.timestamp == 0) revert RootNotFound();
        if (record.revoked) revert RootAlreadyRevoked();

        record.revoked = true;
        LatestRecord storage latest = latestRecords[subjectId][policyId];
        if (latest.versionId == versionId) {
            latest.record.revoked = true;
        }

        emit RootRevoked(subjectId, versionId, policyId, reasonURI, msg.sender);
    }

    function getRoot(
        bytes32 subjectId,
        bytes32 versionId,
        bytes32 policyId
    )
        external
        view
        returns (
            bytes32 root,
            string memory manifestURI,
            string memory metadataURI,
            address publisher,
            uint64 timestamp,
            bool revoked
        )
    {
        RootRecord storage record = records[subjectId][versionId][policyId];
        return (
            record.root,
            record.manifestURI,
            record.metadataURI,
            record.publisher,
            record.timestamp,
            record.revoked
        );
    }

    function hasRoot(
        bytes32 subjectId,
        bytes32 versionId,
        bytes32 policyId
    ) external view returns (bool) {
        return records[subjectId][versionId][policyId].timestamp != 0;
    }

    function getLatestRoot(
        bytes32 subjectId,
        bytes32 policyId
    )
        external
        view
        returns (
            bytes32 versionId,
            bytes32 root,
            string memory manifestURI,
            string memory metadataURI,
            address publisher,
            uint64 timestamp,
            bool revoked
        )
    {
        LatestRecord storage latest = latestRecords[subjectId][policyId];
        RootRecord storage record = latest.record;
        return (
            latest.versionId,
            record.root,
            record.manifestURI,
            record.metadataURI,
            record.publisher,
            record.timestamp,
            record.revoked
        );
    }
}
