// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * KryptoCzat – paid wallet-to-wallet messages, fully on Base.
 *
 *  - Sending a message costs `sendPrice` USDC (default 0.50 USDC); reading is free.
 *  - The fee goes straight to `treasury` (the contract never holds funds).
 *  - Message bodies are stored on-chain. Messages to activated inboxes are
 *    end-to-end encrypted in the browser (X25519 + XSalsa20-Poly1305) – only the
 *    ciphertext is on-chain. Messages with `encrypted = false` are public.
 *  - `owner` (admin) can change the price, fee recipient, size limit and pause sending.
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract PaidMessenger {
    struct Message {
        address from;
        address to;
        uint64 sentAt;
        bool encrypted;
        bytes body;
    }

    address public immutable token;
    address public owner;
    address public treasury;
    uint256 public sendPrice;
    uint256 public maxBodyLength = 4096;
    bool public paused;

    Message[] private _messages;
    mapping(address => uint256[]) private _inbox;
    mapping(address => uint256[]) private _outbox;
    mapping(address => bytes32) public encryptionKey;

    event MessageSent(uint256 indexed id, address indexed from, address indexed to, bool encrypted);
    event KeyRegistered(address indexed user, bytes32 key);
    event PriceChanged(uint256 sendPrice);
    event TreasuryChanged(address treasury);
    event MaxBodyLengthChanged(uint256 maxBodyLength);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PausedChanged(bool paused);

    error NotOwner();
    error ZeroAddress();
    error InvalidRecipient();
    error InvalidBody();
    error BadId();
    error PaymentFailed();
    error IsPaused();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address token_, address owner_, address treasury_, uint256 sendPrice_) {
        if (token_ == address(0) || owner_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        token = token_;
        owner = owner_;
        treasury = treasury_;
        sendPrice = sendPrice_;
        emit OwnershipTransferred(address(0), owner_);
        emit TreasuryChanged(treasury_);
        emit PriceChanged(sendPrice_);
    }

    // ------------------------------------------------------------------ users

    /// Stores the user's public encryption key (X25519) – "activates the inbox".
    function registerKey(bytes32 key) external {
        _setKey(key);
    }

    /// Sends a message and charges the fee. `myKey` (optional) also activates the sender's inbox.
    function sendMessage(address to, bytes calldata body, bool encrypted, bytes32 myKey)
        external
        returns (uint256 id)
    {
        if (paused) revert IsPaused();
        if (to == address(0) || to == msg.sender) revert InvalidRecipient();
        if (body.length == 0 || body.length > maxBodyLength) revert InvalidBody();
        if (myKey != bytes32(0) && myKey != encryptionKey[msg.sender]) _setKey(myKey);

        id = _messages.length;
        _messages.push(
            Message({from: msg.sender, to: to, sentAt: uint64(block.timestamp), encrypted: encrypted, body: body})
        );
        _inbox[to].push(id);
        _outbox[msg.sender].push(id);
        emit MessageSent(id, msg.sender, to, encrypted);

        uint256 price = sendPrice;
        if (price > 0) {
            (bool ok, bytes memory data) =
                token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, msg.sender, treasury, price));
            if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert PaymentFailed();
        }
    }

    // ------------------------------------------------------------------ views

    function messageCount() external view returns (uint256) {
        return _messages.length;
    }

    function getMessage(uint256 id) external view returns (Message memory) {
        if (id >= _messages.length) revert BadId();
        return _messages[id];
    }

    function inboxLength(address user) external view returns (uint256) {
        return _inbox[user].length;
    }

    function outboxLength(address user) external view returns (uint256) {
        return _outbox[user].length;
    }

    function getInbox(address user, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Message[] memory msgs)
    {
        return _page(_inbox[user], offset, limit);
    }

    function getOutbox(address user, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Message[] memory msgs)
    {
        return _page(_outbox[user], offset, limit);
    }

    // ------------------------------------------------------------------ admin

    function setPrice(uint256 sendPrice_) external onlyOwner {
        sendPrice = sendPrice_;
        emit PriceChanged(sendPrice_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    function setMaxBodyLength(uint256 maxBodyLength_) external onlyOwner {
        maxBodyLength = maxBodyLength_;
        emit MaxBodyLengthChanged(maxBodyLength_);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedChanged(paused_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ------------------------------------------------------------------ internal

    function _setKey(bytes32 key) internal {
        encryptionKey[msg.sender] = key;
        emit KeyRegistered(msg.sender, key);
    }

    function _page(uint256[] storage list, uint256 offset, uint256 limit)
        internal
        view
        returns (uint256[] memory ids, Message[] memory msgs)
    {
        uint256 len = list.length;
        if (offset >= len) return (new uint256[](0), new Message[](0));
        uint256 end = offset + limit;
        if (end > len) end = len;
        uint256 n = end - offset;
        ids = new uint256[](n);
        msgs = new Message[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 id = list[offset + i];
            ids[i] = id;
            msgs[i] = _messages[id];
        }
    }
}
