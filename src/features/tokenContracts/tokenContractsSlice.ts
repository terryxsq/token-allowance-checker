import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { v4 as uuidv4 } from 'uuid';
import {AppThunk} from '../../app/store'
import wellKnownContracts from '../../utils/wellKnownContracts'
import {ERC20DetailedInstance} from '../../contracts'
import ERC20Detailed from 'contracts'
import {AddressId, addAddressThunk} from 'features/addressInput/AddressSlice'
import {AllowanceId, fetchAllowanceValueThunk} from '../allowancesList/AllowancesListSlice'
import {addTransaction, TransactionStates, updateTransaction} from 'features/transactionTracker/TransactionTrackerSlice'
import BN from 'bn.js'

interface tokenContract {
    addressId: AddressId,
    name: string
    symbol: string
    decimals: BN
    totalSupply: BN
    contractInstance: ERC20DetailedInstance
}
interface tokenContractPayload {
    id: AddressId,
    tokenContract: tokenContract
}

interface tokenContractsState {
    contractsById: Record<AddressId, tokenContract>
}

const initialState:tokenContractsState = {
    contractsById: {}
}

const tokenContractSlice = createSlice({
    name: 'tokenContracts',
    initialState: initialState,
    reducers: {
        addContract: {
            reducer(state, action: PayloadAction<tokenContractPayload>) {
                const {id, tokenContract} = action.payload
                state.contractsById[id] = tokenContract
            },
            prepare(contractAddress: AddressId, tokenName: string, tokenSymbol: string, decimals:BN, totalSupply:BN, contractInstance:ERC20Detailed.ERC20DetailedInstance) {
                return {
                    payload: {
                        id: contractAddress,
                        tokenContract: {
                            addressId: contractAddress,
                            name: tokenName,
                            symbol: tokenSymbol,
                            decimals,
                            totalSupply,
                            contractInstance
                        }
                    }
                }
            }
        }
    }
})

export const { addContract } = tokenContractSlice.actions

export default tokenContractSlice.reducer

export const addContractThunk = (contractInstance: ERC20Detailed.ERC20DetailedInstance): AppThunk => async (dispatch, getState) => {
    const {networkId} = getState().onboard
    let contractAddress = contractInstance.address.toLowerCase()
    let tokenName = ''
    let tokenSymbol = ''
    // Some contracts like MKR and SAI do not implement the correct ERC20 name and symbol.
    // Get their data from hardocded fallback
    if (Object.keys(wellKnownContracts[networkId]).includes(contractAddress.toLowerCase())) {
        tokenName = wellKnownContracts[networkId][contractAddress.toLowerCase()].name
        tokenSymbol = wellKnownContracts[networkId][contractAddress.toLowerCase()].symbol
    } else {
        try {
            tokenName = await contractInstance.name()
            tokenSymbol = await contractInstance.symbol()
        } catch(error) {
            // Most likely token contract does not implement the name() method. Ignore error.
            console.log(`Failed to get name/symbol of contract at ${contractAddress}. Please raise
                an issue to add this token at https://github.com/TripleSpeeder/token-allowance-checker/issues!`)
        }
    }
    let decimals = new BN('0')
    try {
        decimals = await contractInstance.decimals()
    } catch(error) {
        console.log(`Contract at ${contractAddress} does not provide decimals(). Assuming 0.`)
    }
    let totalSupply
    try {
        totalSupply = await contractInstance.totalSupply()
    } catch (error) {
        console.log(`Failed to call totalSupply() at ${contractAddress}. Ignoring contract.`)
        return
    }
    dispatch(addAddressThunk(contractAddress))
    dispatch(addContract(contractAddress, tokenName, tokenSymbol, decimals, totalSupply, contractInstance))
}

export const setAllowanceThunk = (tokenContractId: AddressId, spender:AddressId, allowance: BN, allowanceId: AllowanceId): AppThunk => async (dispatch, getState) => {
    console.log(`Setting new allowance ${allowance.toString()} for tokenContractId ${tokenContractId}`)
    const {contractInstance} = getState().tokenContracts.contractsById[tokenContractId]
    const {walletAddressId} = getState().addresses
    const transactionId:string = uuidv4()
    dispatch(addTransaction({
        transactionId,
        allowanceId,
        transactionState: TransactionStates.SUBMITTED,
    }))
    try {
        const result = await contractInstance.approve(spender, allowance.toString(), {
            from: walletAddressId,
        })
        console.log(`transaction confirmed: ${result.tx}. Reloading allowance.`)
        dispatch(updateTransaction({
            transactionId,
            transactionState: TransactionStates.CONFIRMED,
            transactionHash: result.tx
        }))
        dispatch(fetchAllowanceValueThunk(allowanceId))
    } catch (e) {
        console.log(`Error while approving: ${e.message}`)
        dispatch(updateTransaction({
            transactionId,
            transactionState: TransactionStates.FAILED,
            error: e.message
        }))
    }
}
