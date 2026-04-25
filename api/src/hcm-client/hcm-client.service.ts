import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { HcmValidationError, HcmUnavailableError } from './hcm-client.errors';

@Injectable()
export class HcmClientService {
  private readonly client: AxiosInstance;

  constructor(private config: ConfigService) {
    this.client = axios.create({
      baseURL: config.get<string>('HCM_BASE_URL'),
      timeout: parseInt(config.get<string>('HCM_TIMEOUT_MS') ?? '3000'),
    });
  }

  async getBalance(
    employeeId: string,
    locationId: string,
  ): Promise<{ balance: number }> {
    try {
      const response = await this.client.get(
        `/balances/${employeeId}/${locationId}`,
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response) {
          if (axiosError.response.status === 422) {
            throw new HcmValidationError(
              'HCM Validation Error',
              axiosError.response.data,
            );
          }
          throw new HcmUnavailableError(
            'HCM Unavailable',
            axiosError.response.status,
          );
        }
      }
      throw new HcmUnavailableError('HCM Unavailable (Network/Timeout)');
    }
  }

  async deductBalance(
    employeeId: string,
    locationId: string,
    days: number,
    idempotencyKey: string,
  ): Promise<{ remainingBalance: number }> {
    try {
      const response = await this.client.post('/deductions', {
        employeeId,
        locationId,
        days,
        idempotencyKey,
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response) {
          if (axiosError.response.status === 422) {
            throw new HcmValidationError(
              'HCM Validation Error',
              axiosError.response.data,
            );
          }
          throw new HcmUnavailableError(
            'HCM Unavailable',
            axiosError.response.status,
          );
        }
      }
      throw new HcmUnavailableError('HCM Unavailable (Network/Timeout)');
    }
  }

  async restoreBalance(
    employeeId: string,
    locationId: string,
    days: number,
    idempotencyKey: string,
  ): Promise<{ restoredBalance: number }> {
    try {
      const response = await this.client.post('/restorations', {
        employeeId,
        locationId,
        days,
        idempotencyKey,
      });
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        throw new HcmUnavailableError(
          'HCM Unavailable',
          axiosError.response.status,
        );
      }
      throw new HcmUnavailableError('HCM Unavailable (Network/Timeout)');
    }
  }
}
