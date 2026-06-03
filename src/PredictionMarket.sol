// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title PredictionMarket
 * @dev A single instance of a prediction market deployed per market on the Pythia protocol.
 */
contract PredictionMarket {
    enum MarketState { OPEN, CLOSED, RESOLVED }

    string public question;
    uint256 public strikePrice;
    uint256 public deadline;
    address public oracle;
    
    mapping(address => uint256) public yesBets;
    mapping(address => uint256) public noBets;
    
    uint256 public totalYes;
    uint256 public totalNo;
    
    bool public outcome; // true = YES won, false = NO won
    MarketState public state;
    
    uint256 public constant FEE_BPS = 200; // 2% protocol fee
    address public treasury;

    // To track if a user has already claimed winnings to prevent double claiming
    mapping(address => bool) public hasClaimed;
    
    // Tracks accumulated protocol fees available for withdrawal
    uint256 public feesToWithdraw;

    event MarketCreated(string question, uint256 strikePrice, uint256 deadline, address oracle, address treasury);
    event BetPlaced(address indexed user, bool side, uint256 amount);
    event MarketClosed();
    event MarketResolved(bool outcome);
    event WinningsClaimed(address indexed user, uint256 amount);

    /**
     * @dev Initializes the market and seeds initial liquidity.
     * Initial liquidity is split 50/50 between YES and NO from msg.value.
     * @param _question The question being predicted.
     * @param _strikePrice The strike price for price-based markets.
     * @param _deadline The deadline after which bets can no longer be placed (unix timestamp).
     * @param _oracle The address of the PythiaOracle contract authorized to resolve this market.
     * @param _treasury The address of the protocol treasury to receive fees.
     */
    constructor(
        string memory _question,
        uint256 _strikePrice,
        uint256 _deadline,
        address _oracle,
        address _treasury
    ) payable {
        require(_deadline > block.timestamp, "Deadline must be in the future");
        require(_oracle != address(0), "Invalid oracle address");
        require(_treasury != address(0), "Invalid treasury address");

        question = _question;
        strikePrice = _strikePrice;
        deadline = _deadline;
        oracle = _oracle;
        treasury = _treasury;
        state = MarketState.OPEN;

        // Seed initial liquidity if msg.value > 0
        if (msg.value > 0) {
            uint256 half = msg.value / 2;
            uint256 remainder = msg.value - half;
            
            yesBets[msg.sender] += half;
            noBets[msg.sender] += remainder;
            
            totalYes += half;
            totalNo += remainder;
            
            emit BetPlaced(msg.sender, true, half);
            emit BetPlaced(msg.sender, false, remainder);
        }

        emit MarketCreated(_question, _strikePrice, _deadline, _oracle, _treasury);
    }

    /**
     * @dev Places a bet on the market.
     * @param side True to bet YES, false to bet NO.
     */
    function placeBet(bool side) external payable {
        require(state == MarketState.OPEN, "Market is not open");
        require(block.timestamp < deadline, "Deadline has passed");
        require(msg.value > 0, "Bet amount must be greater than zero");

        if (side) {
            yesBets[msg.sender] += msg.value;
            totalYes += msg.value;
        } else {
            noBets[msg.sender] += msg.value;
            totalNo += msg.value;
        }

        emit BetPlaced(msg.sender, side, msg.value);
    }

    /**
     * @dev Closes the market for new bets. Callable by anyone once the deadline is reached.
     */
    function closeMarket() external {
        require(state == MarketState.OPEN, "Market is not open");
        require(block.timestamp >= deadline, "Deadline not yet reached");

        state = MarketState.CLOSED;

        emit MarketClosed();
    }

    /**
     * @dev Resolves the market with the final outcome. Only callable by the oracle.
     * @param _outcome True if YES won, false if NO won.
     */
    function resolve(bool _outcome) external {
        require(state == MarketState.CLOSED, "Market must be closed before resolution");
        require(msg.sender == oracle, "Only oracle can resolve");

        outcome = _outcome;
        state = MarketState.RESOLVED;

        emit MarketResolved(_outcome);
    }

    /**
     * @dev Claims the winning payout for the caller.
     * Calculates proportional share of the winning pool minus the protocol fee.
     */
    function claimWinnings() external {
        require(state == MarketState.RESOLVED, "Market is not resolved");
        require(!hasClaimed[msg.sender], "Already claimed");

        uint256 userBetAmount = outcome ? yesBets[msg.sender] : noBets[msg.sender];
        require(userBetAmount > 0, "No winning bets");

        hasClaimed[msg.sender] = true;

        uint256 winningPool = outcome ? totalYes : totalNo;
        uint256 totalPool = totalYes + totalNo;

        // Calculate proportional share of the entire pool
        uint256 totalPayout = (userBetAmount * totalPool) / winningPool;
        
        // Calculate protocol fee
        uint256 fee = (totalPayout * FEE_BPS) / 10000;
        uint256 amountToTransfer = totalPayout - fee;

        feesToWithdraw += fee;

        // Transfer funds to the winner
        (bool success, ) = msg.sender.call{value: amountToTransfer}("");
        require(success, "Transfer failed");

        emit WinningsClaimed(msg.sender, amountToTransfer);
    }

    /**
     * @dev Withdraws accumulated protocol fees. Only callable by the treasury.
     */
    function withdrawFees() external {
        require(msg.sender == treasury, "Only treasury can withdraw fees");
        
        uint256 amount = feesToWithdraw;
        require(amount > 0, "No fees to withdraw");

        feesToWithdraw = 0;

        (bool success, ) = treasury.call{value: amount}("");
        require(success, "Transfer failed");
    }
}
