const { ethers } = require('ethers');
console.log('uint256,address,bytes4,bytes:', ethers.id('createRequest(uint256,address,bytes4,bytes)').slice(0,10));
console.log('uint256,bytes,address,bytes4:', ethers.id('createRequest(uint256,bytes,address,bytes4)').slice(0,10));
