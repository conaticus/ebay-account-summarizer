export interface TimeInfo {
    seconds: number;
    minutes: number;
    hours: number;
    days: number;
    months: number;
    years: number;
}

export function getTimeSince(date: Date): TimeInfo {
    const currentDate = new Date();
    const timeDifference = currentDate.getTime() - date.getTime();

    return getTimeInfo(timeDifference);
}

function getTimeInfo(time: number): TimeInfo {
    const seconds = Math.floor(time / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(months / 12);

    return {
        seconds,
        minutes,
        hours,
        days,
        months,
        years,
    };
}
