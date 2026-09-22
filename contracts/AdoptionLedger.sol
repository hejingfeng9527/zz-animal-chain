// SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;

interface ICharityPoints {
    function award(address to, uint256 amount, string calldata reason) external;
    function deduct(address from, uint256 amount, string calldata reason) external;
}

interface IRescueLedger {
    function markAdopted(uint256 id, address guardian, bytes32 contractHash) external;
    function getAnimal(uint256 id)
        external
        view
        returns (
            uint256 aid,
            bytes32 dataHash,
            string memory metaURI,
            string memory species,
            string memory title,
            int256 lat1e6,
            int256 lng1e6,
            string memory addressText,
            uint8 severity,
            bool urgent,
            uint8 status,
            address reporter,
            address shelter,
            address guardian,
            bool reviewed,
            uint64 createdAt,
            uint64 updatedAt,
            bool exists
        );
    function updateStatus(uint256 id, uint8 newStatus, bytes32 evidenceHash, string calldata note) external;
}

/**
 * @title AdoptionLedger
 * @notice 郑州流浪动物救助导航 · 领养全流程上链台账
 * @dev 领养申请提交 → 背景核验 → 管理员审核（含回访计划/驳回理由）→ 领养签约 →
 *      回访记录，全部写入链上。任意一次流转都可溯源，防止弃养与二次流浪。
 *
 * 适配：FISCO BCOS 3.x (solidity 0.8.11)
 */
contract AdoptionLedger {
    enum Stage {
        Applied,    // 0 已提交申请
        Screening,  // 1 背景核验中
        Approved,   // 2 审核通过，待签约
        Rejected,   // 3 已驳回
        Signed,     // 4 已签约，托管权移交
        Completed,  // 5 回访达标，领养完成
        Cancelled   // 6 取消 / 违约
    }

    struct Application {
        uint256 id;
        uint256 animalId;
        address applicant;
        bytes32 formHash;       // 申请表内容哈希
        string  formURI;        // 申请表明细
        bytes32 bgCheckHash;    // 背景核验材料哈希
        bool    bgPassed;
        string  bgNote;
        uint8   stage;
        address reviewer;
        string  rejectReason;
        string  visitPlan;      // 回访计划（如"首月每周 1 次，之后每月 1 次，共 6 次"）
        bytes32 contractHash;   // 领养协议哈希
        address shelter;        // 出借方（救助站）
        uint64  createdAt;
        uint64  updatedAt;
        uint64  signedAt;
        uint64  completedAt;
        bool    exists;
    }

    struct VisitRecord {
        uint256 appId;
        address recorder;
        bytes32 evidenceHash;   // 回访照片/记录哈希
        string  note;
        bool    passed;
        uint8   round;          // 第几次回访
        uint64  ts;
    }

    address public owner;
    uint256 public appCount;

    mapping(address => bool) public admins;
    mapping(address => bool) public shelters;
    mapping(uint256 => Application) private apps;
    mapping(uint256 => VisitRecord[]) private visits;
    mapping(address => uint256[]) private appsOfApplicant;
    mapping(uint256 => uint256[]) private appsOfAnimal;

    ICharityPoints public points;
    IRescueLedger public ledger;

    uint256 public constant POINT_VISIT = 5;
    uint256 public constant POINT_COMPLETE = 30;
    uint256 public constant PENALTY_ABANDON = 30;
    uint256 public constant REQUIRED_VISITS = 3;

    event ApplicationSubmitted(uint256 indexed id, uint256 indexed animalId, address indexed applicant, bytes32 formHash, uint64 ts);
    event BackgroundChecked(uint256 indexed id, address indexed operator, bool passed, bytes32 bgCheckHash, string note, uint64 ts);
    event ApplicationReviewed(uint256 indexed id, address indexed reviewer, bool approved, string reason, string visitPlan, uint64 ts);
    event AdoptionSigned(uint256 indexed id, uint256 indexed animalId, address indexed applicant, bytes32 contractHash, uint64 ts);
    event VisitRecorded(uint256 indexed id, address indexed recorder, uint8 round, bytes32 evidenceHash, bool passed, uint64 ts);
    event AdoptionCompleted(uint256 indexed id, address indexed applicant, uint64 ts);
    event AdoptionCancelled(uint256 indexed id, address indexed applicant, string reason, uint64 ts);
    event AbandonFlagged(uint256 indexed id, address indexed applicant, string reason, uint64 ts);

    modifier onlyOwner() {
        require(msg.sender == owner, "Adoption: not owner");
        _;
    }

    modifier onlyAdmin() {
        require(admins[msg.sender] || msg.sender == owner, "Adoption: not admin");
        _;
    }

    modifier onlyAdminOrShelter() {
        require(admins[msg.sender] || shelters[msg.sender] || msg.sender == owner, "Adoption: not privileged");
        _;
    }

    constructor() {
        owner = msg.sender;
        admins[msg.sender] = true;
    }

    function setAdmin(address account, bool enabled) external onlyOwner {
        admins[account] = enabled;
    }

    function setShelter(address account, bool enabled) external onlyOwner {
        shelters[account] = enabled;
    }

    function setPointsContract(address addr) external onlyOwner {
        points = ICharityPoints(addr);
    }

    function setRescueLedger(address addr) external onlyOwner {
        ledger = IRescueLedger(addr);
    }

    // ---------------- 领养流程 ----------------

    /// @notice 用户提交领养申请，formHash 为申请表内容 SHA-256
    function applyFor(uint256 animalId, bytes32 formHash, string calldata formURI)
        external
        returns (uint256 id)
    {
        require(formHash != bytes32(0), "Adoption: empty form hash");
        id = ++appCount;
        apps[id] = Application({
            id: id,
            animalId: animalId,
            applicant: msg.sender,
            formHash: formHash,
            formURI: formURI,
            bgCheckHash: bytes32(0),
            bgPassed: false,
            bgNote: "",
            stage: uint8(Stage.Applied),
            reviewer: address(0),
            rejectReason: "",
            visitPlan: "",
            contractHash: bytes32(0),
            shelter: address(0),
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp),
            signedAt: 0,
            completedAt: 0,
            exists: true
        });
        _pushUnique(appsOfAnimal[animalId], id);
        _pushUnique(appsOfApplicant[msg.sender], id);
        emit ApplicationSubmitted(id, animalId, msg.sender, formHash, uint64(block.timestamp));
    }

    /// @notice 背景核验（居住条件、家庭成员意见、既往饲养记录等）
    function backgroundCheck(
        uint256 id,
        bytes32 bgCheckHash,
        bool passed,
        string calldata note
    ) external onlyAdmin {
        Application storage a = apps[id];
        require(a.exists, "Adoption: not exist");
        require(a.stage == uint8(Stage.Applied) || a.stage == uint8(Stage.Screening), "Adoption: bad stage");
        a.bgCheckHash = bgCheckHash;
        a.bgPassed = passed;
        a.bgNote = note;
        a.stage = uint8(Stage.Screening);
        a.updatedAt = uint64(block.timestamp);
        emit BackgroundChecked(id, msg.sender, passed, bgCheckHash, note, uint64(block.timestamp));
    }

    /// @notice 管理员审核：通过需写明回访计划，驳回需写明驳回理由
    function reviewApplication(
        uint256 id,
        bool approved,
        string calldata reason,
        string calldata visitPlan
    ) external onlyAdmin {
        Application storage a = apps[id];
        require(a.exists, "Adoption: not exist");
        require(a.stage == uint8(Stage.Applied) || a.stage == uint8(Stage.Screening), "Adoption: bad stage");
        a.reviewer = msg.sender;
        a.updatedAt = uint64(block.timestamp);
        if (approved) {
            a.stage = uint8(Stage.Approved);
            a.visitPlan = visitPlan;
        } else {
            require(bytes(reason).length > 0, "Adoption: reject reason required");
            a.stage = uint8(Stage.Rejected);
            a.rejectReason = reason;
        }
        emit ApplicationReviewed(id, msg.sender, approved, reason, visitPlan, uint64(block.timestamp));
    }

    /// @notice 领养签约：写入协议哈希并触发救助台账的托管权转移
    function signContract(uint256 id, bytes32 contractHash) external onlyAdminOrShelter {
        Application storage a = apps[id];
        require(a.exists, "Adoption: not exist");
        require(a.stage == uint8(Stage.Approved), "Adoption: not approved");
        require(contractHash != bytes32(0), "Adoption: empty contract hash");

        a.stage = uint8(Stage.Signed);
        a.contractHash = contractHash;
        a.signedAt = uint64(block.timestamp);
        a.updatedAt = uint64(block.timestamp);
        a.shelter = msg.sender;

        if (address(ledger) != address(0)) {
            ledger.markAdopted(a.animalId, a.applicant, contractHash);
        }
        emit AdoptionSigned(id, a.animalId, a.applicant, contractHash, uint64(block.timestamp));
    }

    /// @notice 回访记录上链（照片/记录哈希 + 结论）
    function addVisitRecord(
        uint256 id,
        bytes32 evidenceHash,
        string calldata note,
        bool passed
    ) external onlyAdminOrShelter {
        Application storage a = apps[id];
        require(a.exists, "Adoption: not exist");
        require(a.stage == uint8(Stage.Signed), "Adoption: not signed");
        uint8 round = uint8(visits[id].length + 1);
        visits[id].push(VisitRecord({
            appId: id,
            recorder: msg.sender,
            evidenceHash: evidenceHash,
            note: note,
            passed: passed,
            round: round,
            ts: uint64(block.timestamp)
        }));
        a.updatedAt = uint64(block.timestamp);
        if (passed && address(points) != address(0)) {
            points.award(a.applicant, POINT_VISIT, "VISIT_PASSED");
        }
        emit VisitRecorded(id, msg.sender, round, evidenceHash, passed, uint64(block.timestamp));
    }

    /// @notice 回访达标后完成领养
    function completeAdoption(uint256 id) external onlyAdmin {
        Application storage a = apps[id];
        require(a.exists, "Adoption: not exist");
        require(a.stage == uint8(Stage.Signed), "Adoption: not signed");
        require(visits[id].length >= REQUIRED_VISITS, "Adoption: visits not enough");
        a.stage = uint8(Stage.Completed);
        a.completedAt = uint64(block.timestamp);
        a.updatedAt = uint64(block.timestamp);
        if (address(points) != address(0)) {
            points.award(a.applicant, POINT_COMPLETE, "ADOPTION_COMPLETED");
        }
        emit AdoptionCompleted(id, a.applicant, uint64(block.timestamp));
    }

    /// @notice 取消申请 / 标记违约弃养（弃养扣积分并动物重新进入待领养）
    function cancelOrFlag(uint256 id, bool isAbandon, string calldata reason) external onlyAdmin {
        Application storage a = apps[id];
        require(a.exists, "Adoption: not exist");
        // 仅「已签约」或「已完成」的领养可标记违约；其余阶段不适用
        require(
            a.stage == uint8(Stage.Signed) || a.stage == uint8(Stage.Completed),
            "Adoption: not active"
        );
        a.stage = uint8(Stage.Cancelled);
        a.rejectReason = reason;
        a.updatedAt = uint64(block.timestamp);
        if (isAbandon) {
            if (address(points) != address(0)) {
                points.deduct(a.applicant, PENALTY_ABANDON, "ABANDON_PENALTY");
            }
            if (address(ledger) != address(0)) {
                ledger.updateStatus(a.animalId, 4, keccak256(abi.encodePacked(id, reason)), "ABANDON_RECOVER_TO_ADOPTABLE");
            }
            emit AbandonFlagged(id, a.applicant, reason, uint64(block.timestamp));
        }
        emit AdoptionCancelled(id, a.applicant, reason, uint64(block.timestamp));
    }

    // ---------------- 查询 ----------------

    function getApplication(uint256 id) external view returns (Application memory) {
        return apps[id];
    }

    function getVisits(uint256 id) external view returns (VisitRecord[] memory) {
        return visits[id];
    }

    function visitCount(uint256 id) external view returns (uint256) {
        return visits[id].length;
    }

    function applicationsOfAnimal(uint256 animalId) external view returns (uint256[] memory) {
        return appsOfAnimal[animalId];
    }

    function applicationsOfApplicant(address applicant) external view returns (uint256[] memory) {
        return appsOfApplicant[applicant];
    }

    function getApplications(uint256 offset, uint256 limit) external view returns (Application[] memory list) {
        if (offset >= appCount || limit == 0) return new Application[](0);
        uint256 end = offset + limit;
        if (end > appCount) end = appCount;
        list = new Application[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            list[i - offset] = apps[i + 1];
        }
    }

    // ---------------- 内部 ----------------

    function _pushUnique(uint256[] storage arr, uint256 v) internal {
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i] == v) return;
        }
        arr.push(v);
    }
}
