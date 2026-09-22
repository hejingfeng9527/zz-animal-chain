// SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;

/**
 * @title CharityPoints
 * @notice 郑州流浪动物救助 · 公益积分合约
 * @dev 只记录公益贡献积分，不涉及任何代币发行与资金转账。
 *      积分由管理员/救助站（minter）根据链上行为发放：
 *      - 上报有效线索    +10
 *      - 参与救助/送医   +20
 *      - 完成领养        +50
 *      - 完成回访        +5
 *      - 恶意上报        -30（以 reason 记录，balanceOf 不为负）
 *
 * 适配：FISCO BCOS 3.x (solidity 0.8.11)；
 *       若使用 FISCO BCOS 2.x，请将 pragma 改为 ^0.6.10 并自行补充 SafeMath。
 */
contract CharityPoints {
    struct Award {
        uint256 amount;     // 正数发放 / 负数扣减用 Deduct 事件单独记录
        string reason;      // 事由（含关联业务 ID）
        address operator;   // 操作者
        uint64 ts;          // 时间戳
    }

    address public owner;
    uint256 public totalSupply;
    uint256 public awardCount;

    mapping(address => bool) public minters;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public totalEarned;
    mapping(address => uint256[]) private awardIndex;

    Award[] private awards;

    event PointsAwarded(address indexed to, uint256 amount, string reason, address indexed operator, uint64 ts);
    event PointsDeducted(address indexed from, uint256 amount, string reason, address indexed operator, uint64 ts);
    event MinterUpdated(address indexed account, bool enabled);

    modifier onlyOwner() {
        require(msg.sender == owner, "CharityPoints: not owner");
        _;
    }

    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner, "CharityPoints: not minter");
        _;
    }

    constructor() {
        owner = msg.sender;
        minters[msg.sender] = true;
        emit MinterUpdated(msg.sender, true);
    }

    function setMinter(address account, bool enabled) external onlyOwner {
        minters[account] = enabled;
        emit MinterUpdated(account, enabled);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "CharityPoints: zero address");
        owner = newOwner;
        minters[newOwner] = true;
        emit MinterUpdated(newOwner, true);
    }

    /// @notice 发放积分
    function award(address to, uint256 amount, string calldata reason) external onlyMinter {
        require(to != address(0), "CharityPoints: zero address");
        require(amount > 0, "CharityPoints: amount zero");
        balanceOf[to] += amount;
        totalEarned[to] += amount;
        totalSupply += amount;
        _append(to, amount, reason);
        emit PointsAwarded(to, amount, reason, msg.sender, uint64(block.timestamp));
    }

    /// @notice 批量发放（一次救助行动多人参与）
    function awardBatch(
        address[] calldata accounts,
        uint256[] calldata amounts,
        string calldata reason
    ) external onlyMinter {
        require(accounts.length == amounts.length, "CharityPoints: length mismatch");
        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0) || amounts[i] == 0) continue;
            balanceOf[accounts[i]] += amounts[i];
            totalEarned[accounts[i]] += amounts[i];
            totalSupply += amounts[i];
            _append(accounts[i], amounts[i], reason);
            emit PointsAwarded(accounts[i], amounts[i], reason, msg.sender, uint64(block.timestamp));
        }
    }

    /// @notice 扣减积分（恶意上报 / 弃养违约），余额不为负
    function deduct(address from, uint256 amount, string calldata reason) external onlyMinter {
        uint256 bal = balanceOf[from];
        uint256 real = amount > bal ? bal : amount;
        if (real == 0) return;
        balanceOf[from] = bal - real;
        totalSupply -= real;
        awardIndex[from].push(awards.length);
        awards.push(Award({amount: real, reason: reason, operator: msg.sender, ts: uint64(block.timestamp)}));
        awardCount += 1;
        emit PointsDeducted(from, real, reason, msg.sender, uint64(block.timestamp));
    }

    function _append(address to, uint256 amount, string memory reason) internal {
        awardIndex[to].push(awards.length);
        awards.push(Award({amount: amount, reason: reason, operator: msg.sender, ts: uint64(block.timestamp)}));
        awardCount += 1;
    }

    /// @notice 查询某账户的积分流水
    function awardsOf(address account) external view returns (Award[] memory list) {
        uint256[] storage idx = awardIndex[account];
        list = new Award[](idx.length);
        for (uint256 i = 0; i < idx.length; i++) {
            list[i] = awards[idx[i]];
        }
    }

    function awardAt(uint256 index) external view returns (Award memory) {
        return awards[index];
    }
}
