// SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;

interface ICharityPoints {
    function award(address to, uint256 amount, string calldata reason) external;
}

/**
 * @title AnimalRescueLedger
 * @notice 郑州流浪动物救助导航 · 线索存证与流转台账
 * @dev 覆盖：线索上报（SHA-256 哈希存证）→ 管理员审核 → 救助站收容 → 治疗 →
 *      待领养 → 领养 的完整链路，每次状态变更与托管权转移均写入链上流转记录，
 *      永久留存，防止弃养导致的二次流浪。
 *
 * 适配：FISCO BCOS 3.x (solidity 0.8.11)
 */
contract AnimalRescueLedger {
    enum Status {
        Reported,   // 0 已上报，待审核
        Verified,   // 1 已核实
        Sheltered,  // 2 已入站收容
        Treating,   // 3 救治中
        Adoptable,  // 4 待领养
        Adopted,    // 5 已领养
        Returned,   // 6 原地放归
        Deceased,   // 7 已死亡
        Rejected    // 8 线索驳回（无效/重复）
    }

    enum Severity { Normal, Injured, Sick, Critical } // 0 健康 1 受伤 2 患病 3 重伤病危

    enum POIKind { Sighting, Shelter, Hospital, Feeding } // 发现点/救助站/宠物医院/投喂点

    struct Animal {
        uint256 id;
        bytes32 dataHash;      // 线索原文 SHA-256 存证哈希
        string  metaURI;       // 明细（IPFS CID / JSON 串），含图片摘要
        string  species;       // 犬 / 猫 / 其他
        string  title;         // 标题，如"金水区受伤橘猫"
        int256  lat1e6;        // 纬度 * 1e6
        int256  lng1e6;        // 经度 * 1e6
        string  addressText;   // 文字地址
        uint8   severity;
        bool    urgent;        // 是否紧急（重伤/病危自动置位）
        uint8   status;
        address reporter;      // 上报人
        address shelter;       // 当前收容方（救助站地址）
        address guardian;      // 领养人
        bool    reviewed;      // 是否已审核
        uint64  createdAt;
        uint64  updatedAt;
        bool    exists;
    }

    struct ReviewRecord {
        address reviewer;
        bool    approved;
        string  reason;
        bytes32 dataHash;
        uint64  ts;
    }

    struct TransferRecord {
        address from;          // 原托管方
        address to;            // 新托管方
        uint8   fromStatus;
        uint8   toStatus;
        bytes32 evidenceHash;  // 交接凭证哈希
        string  note;
        address operator;
        uint64  ts;
    }

    struct POI {
        uint256 id;
        uint8   kind;
        string  name;
        string  addressText;
        int256  lat1e6;
        int256  lng1e6;
        string  contact;
        address owner;
        bool    active;
        uint64  ts;
    }

    address public owner;
    uint256 public animalCount;
    uint256 public poiCount;

    mapping(address => bool) public admins;          // 管理员（审核/流转）
    mapping(address => bool) public shelters;        // 救助站
    mapping(uint256 => Animal) private animals;
    mapping(uint256 => ReviewRecord) public reviewOf;
    mapping(uint256 => TransferRecord[]) private transfers;
    mapping(uint256 => POI) private pois;
    mapping(uint256 => uint256) public urgentIndex;  // animalId => 上报序号，用于优先队列

    ICharityPoints public points;

    uint256 public constant POINT_REPORT = 10;
    uint256 public constant POINT_SHELTER = 20;
    uint256 public constant POINT_ADOPT = 50;

    event AnimalReported(
        uint256 indexed id,
        address indexed reporter,
        bytes32 dataHash,
        uint8 severity,
        bool urgent,
        uint64 ts
    );
    event AnimalReviewed(uint256 indexed id, address indexed reviewer, bool approved, string reason, uint64 ts);
    event AnimalStatusUpdated(
        uint256 indexed id,
        uint8 fromStatus,
        uint8 toStatus,
        address indexed operator,
        bytes32 evidenceHash,
        string note,
        uint64 ts
    );
    event CustodyTransferred(
        uint256 indexed id,
        address indexed from,
        address indexed to,
        bytes32 evidenceHash,
        uint64 ts
    );
    event POIRegistered(uint256 indexed id, uint8 kind, string name, address indexed owner, uint64 ts);
    event AdminUpdated(address indexed account, bool enabled);
    event ShelterUpdated(address indexed account, bool enabled);

    modifier onlyOwner() {
        require(msg.sender == owner, "Ledger: not owner");
        _;
    }

    modifier onlyAdmin() {
        require(admins[msg.sender] || msg.sender == owner, "Ledger: not admin");
        _;
    }

    modifier onlyAdminOrShelter() {
        require(admins[msg.sender] || shelters[msg.sender] || msg.sender == owner, "Ledger: not privileged");
        _;
    }

    constructor() {
        owner = msg.sender;
        admins[msg.sender] = true;
        emit AdminUpdated(msg.sender, true);
    }

    function setPointsContract(address addr) external onlyOwner {
        points = ICharityPoints(addr);
    }

    function setAdmin(address account, bool enabled) external onlyOwner {
        admins[account] = enabled;
        emit AdminUpdated(account, enabled);
    }

    function setShelter(address account, bool enabled) external onlyOwner {
        shelters[account] = enabled;
        emit ShelterUpdated(account, enabled);
    }

    // ---------------- 点位（救助站 / 医院 / 投喂点 / 发现点） ----------------

    function registerPOI(
        uint8 kind,
        string calldata name,
        string calldata addressText,
        int256 lat1e6,
        int256 lng1e6,
        string calldata contact
    ) external returns (uint256 id) {
        require(bytes(name).length > 0, "Ledger: empty name");
        id = ++poiCount;
        pois[id] = POI({
            id: id,
            kind: kind,
            name: name,
            addressText: addressText,
            lat1e6: lat1e6,
            lng1e6: lng1e6,
            contact: contact,
            owner: msg.sender,
            active: true,
            ts: uint64(block.timestamp)
        });
        emit POIRegistered(id, kind, name, msg.sender, uint64(block.timestamp));
    }

    function setPOIActive(uint256 id, bool active) external onlyAdmin {
        require(pois[id].id != 0, "Ledger: poi not exist");
        pois[id].active = active;
    }

    function getPOI(uint256 id) external view returns (POI memory) {
        return pois[id];
    }

    // ---------------- 线索上报 ----------------

    /// @notice 上报入参（打包为结构体，避免参数过多导致栈过深）
    struct ReportInput {
        bytes32 dataHash;      // 线索原文 SHA-256 存证哈希
        string  metaURI;       // 明细（IPFS CID / JSON 串）
        string  species;       // 犬 / 猫 / 其他
        string  title;
        int256  lat1e6;
        int256  lng1e6;
        string  addressText;
        uint8   severity;      // 0 健康 1 受伤 2 患病 3 重伤病危（自动置为紧急）
    }

    /// @notice 用户/管理员上报需要帮助的流浪动物，dataHash 为线索原文 SHA-256
    function reportAnimal(ReportInput calldata input) external returns (uint256 id) {
        require(input.dataHash != bytes32(0), "Ledger: empty hash");
        require(bytes(input.title).length > 0, "Ledger: empty title");

        id = ++animalCount;
        bool urgent = input.severity >= uint8(Severity.Critical);

        animals[id] = Animal({
            id: id,
            dataHash: input.dataHash,
            metaURI: input.metaURI,
            species: input.species,
            title: input.title,
            lat1e6: input.lat1e6,
            lng1e6: input.lng1e6,
            addressText: input.addressText,
            severity: input.severity,
            urgent: urgent,
            status: uint8(Status.Reported),
            reporter: msg.sender,
            shelter: address(0),
            guardian: address(0),
            reviewed: false,
            createdAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp),
            exists: true
        });

        if (urgent) urgentIndex[id] = id;
        emit AnimalReported(id, msg.sender, input.dataHash, input.severity, urgent, uint64(block.timestamp));
    }

    /// @notice 管理员审核线索（通过后发放公益积分）
    function reviewAnimal(uint256 id, bool approved, string calldata reason) external onlyAdmin {
        Animal storage a = animals[id];
        require(a.exists, "Ledger: not exist");
        require(!a.reviewed, "Ledger: already reviewed");

        a.reviewed = true;
        a.status = approved ? uint8(Status.Verified) : uint8(Status.Rejected);
        a.updatedAt = uint64(block.timestamp);
        reviewOf[id] = ReviewRecord({
            reviewer: msg.sender,
            approved: approved,
            reason: reason,
            dataHash: a.dataHash,
            ts: uint64(block.timestamp)
        });

        if (approved && address(points) != address(0)) {
            points.award(a.reporter, POINT_REPORT, "REPORT_VERIFIED");
        }

        emit AnimalReviewed(id, msg.sender, approved, reason, uint64(block.timestamp));
    }

    /// @notice 状态流转（入站 / 救治 / 转待领养 / 放归 / 死亡…）
    function updateStatus(
        uint256 id,
        uint8 newStatus,
        bytes32 evidenceHash,
        string calldata note
    ) external onlyAdminOrShelter {
        Animal storage a = animals[id];
        require(a.exists, "Ledger: not exist");
        require(a.reviewed, "Ledger: not reviewed");
        uint8 old = a.status;
        a.status = newStatus;
        a.updatedAt = uint64(block.timestamp);
        if (newStatus == uint8(Status.Sheltered) && a.shelter == address(0)) {
            a.shelter = msg.sender;
            if (address(points) != address(0)) {
                points.award(msg.sender, POINT_SHELTER, "SHELTER_INTAKE");
            }
        }
        _appendTransfer(id, address(0), address(0), old, newStatus, evidenceHash, note);
        emit AnimalStatusUpdated(id, old, newStatus, msg.sender, evidenceHash, note, uint64(block.timestamp));
    }

    /// @notice 托管权转移：救助站 -> 领养人（或站间转运），永久留痕
    function transferCustody(
        uint256 id,
        address to,
        uint8 newStatus,
        bytes32 evidenceHash,
        string calldata note
    ) external onlyAdminOrShelter {
        Animal storage a = animals[id];
        require(a.exists, "Ledger: not exist");
        require(to != address(0), "Ledger: zero addr");
        require(a.reviewed, "Ledger: not reviewed");

        uint8 old = a.status;
        address from = a.guardian != address(0) ? a.guardian : a.shelter;
        if (from == address(0)) from = msg.sender;

        a.status = newStatus;
        a.guardian = (newStatus == uint8(Status.Adopted)) ? to : a.guardian;
        if (newStatus != uint8(Status.Adopted)) a.shelter = to;
        a.updatedAt = uint64(block.timestamp);

        _appendTransfer(id, from, to, old, newStatus, evidenceHash, note);
        emit CustodyTransferred(id, from, to, evidenceHash, uint64(block.timestamp));
        emit AnimalStatusUpdated(id, old, newStatus, msg.sender, evidenceHash, note, uint64(block.timestamp));
    }

    /// @notice 领养完成时由领养合约回调，写入领养人并发放积分
    function markAdopted(uint256 id, address guardian, bytes32 contractHash) external onlyAdmin {
        Animal storage a = animals[id];
        require(a.exists, "Ledger: not exist");
        uint8 old = a.status;
        a.status = uint8(Status.Adopted);
        a.guardian = guardian;
        a.updatedAt = uint64(block.timestamp);
        _appendTransfer(id, a.shelter, guardian, old, uint8(Status.Adopted), contractHash, "ADOPTION_SIGNED_CUSTODY_TRANSFER");
        emit CustodyTransferred(id, a.shelter, guardian, contractHash, uint64(block.timestamp));
        if (address(points) != address(0)) {
            points.award(guardian, POINT_ADOPT, "ADOPTION_SIGNED");
        }
    }

    function _appendTransfer(
        uint256 id,
        address from,
        address to,
        uint8 fromStatus,
        uint8 toStatus,
        bytes32 evidenceHash,
        string memory note
    ) internal {
        transfers[id].push(TransferRecord({
            from: from,
            to: to,
            fromStatus: fromStatus,
            toStatus: toStatus,
            evidenceHash: evidenceHash,
            note: note,
            operator: msg.sender,
            ts: uint64(block.timestamp)
        }));
    }

    // ---------------- 查询 ----------------

    function getAnimal(uint256 id) external view returns (Animal memory) {
        return animals[id];
    }

    function getTransfers(uint256 id) external view returns (TransferRecord[] memory) {
        return transfers[id];
    }

    function getReview(uint256 id) external view returns (ReviewRecord memory) {
        return reviewOf[id];
    }

    /// @notice 分页摘要，便于前端列表渲染
    function getAnimals(uint256 offset, uint256 limit)
        external
        view
        returns (Animal[] memory list)
    {
        if (offset >= animalCount || limit == 0) return new Animal[](0);
        uint256 end = offset + limit;
        if (end > animalCount) end = animalCount;
        list = new Animal[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            list[i - offset] = animals[i + 1];
        }
    }
}
