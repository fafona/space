import type { EuropeCountryOption, EuropeProvinceOption } from "./europeLocationOptions";

export type EuropeLocationOptionsApi = {
  getEuropeCountryOptions: () => EuropeCountryOption[];
  getEuropeProvinceOptions: (countryCode: string) => EuropeProvinceOption[];
  getEuropeCityOptions: (countryCode: string, provinceCode: string) => string[];
  findEuropeCountryByCode: (countryCode: string) => EuropeCountryOption | null;
  findBestProvinceCode: (countryCode: string, provinceName: string) => string;
  findBestCityName: (countryCode: string, provinceCode: string, cityName: string) => string;
  findBestProvinceAndCity: (
    countryCode: string,
    provinceName: string,
    cityName: string,
  ) => { provinceCode: string; cityName: string };
};

let europeLocationOptionsApiPromise: Promise<EuropeLocationOptionsApi> | null = null;

export function loadEuropeLocationOptionsApi() {
  if (!europeLocationOptionsApiPromise) {
    europeLocationOptionsApiPromise = import("./europeLocationOptions")
      .then((mod) => ({
        getEuropeCountryOptions: mod.getEuropeCountryOptions,
        getEuropeProvinceOptions: mod.getEuropeProvinceOptions,
        getEuropeCityOptions: mod.getEuropeCityOptions,
        findEuropeCountryByCode: mod.findEuropeCountryByCode,
        findBestProvinceCode: mod.findBestProvinceCode,
        findBestCityName: mod.findBestCityName,
        findBestProvinceAndCity: mod.findBestProvinceAndCity,
      }))
      .catch((error) => {
        europeLocationOptionsApiPromise = null;
        throw error;
      });
  }
  return europeLocationOptionsApiPromise;
}
